const info = process.argv.length >= 3
    ? JSON.parse(process.argv[2])
    : {};

let input = '';
process.stdin.on('data', d => {
    try {
        input += d.toString();
    } catch (err) {
        console.error(`Could not read input into string: ${err.message}`, err.stack);
        process.exit(1);
    }
});

process.stdin.on('end', async () => {
    const data = JSON.parse(input);
    const configuration = getPluginConfiguration(data);
    const changedObjects = [];
    const addedIds = {};

    for (let object of data.objects) {
        if (await processObject(object, configuration, addedIds)) changedObjects.push(object);
    }

    console.log(JSON.stringify({ objects: changedObjects }));

    if (!changedObjects.length) {
        console.error('No changes');
        process.exit(0);
    }
});

function getPluginConfiguration(data) {
    return data.info.config.plugin['numeric-id-auto-incrementer'].config.numericIdAutoIncrementer;
}

async function processObject(object, configuration, addedIds) {
    const nestedFieldsConfiguration = getNestedFieldsConfiguration(configuration, object._objecttype);
    const indexerSettings = {
        maxNotIndexed: configuration.max_not_indexed,
        errorMessage: configuration.indexer_error_message
    };
    let changed = false;

    for (let nestedFieldConfiguration of nestedFieldsConfiguration) {
        if (!isInConfiguredPool(object, nestedFieldConfiguration)) continue;
        if (await processNestedFields(object, nestedFieldConfiguration, indexerSettings, addedIds)) changed = true;
    }

    return changed;
}

function getNestedFieldsConfiguration(configuration, objectType) {
    return configuration.object_types
        ?.find(configuration => configuration.name === objectType)
        ?.nested_fields ?? [];
}

function isInConfiguredPool(object, nestedFieldConfiguration) {
    const poolIds = nestedFieldConfiguration.pool_ids?.map(pool => pool.pool_id);
    if (!poolIds?.length) return true;
    
    for (let objectPool of object[object._objecttype]._pool._path) {
        if (poolIds.includes(objectPool.pool._id.toString())) return true;
    }
    return false;
}

async function processNestedFields(object, nestedFieldConfiguration, indexerSettings, addedIds) {
    const nestedFields = getNestedFields(object, nestedFieldConfiguration.field_path);

    let changed = false;
    for (let nestedField of nestedFields) {
        if (await addId(
            object._objecttype,
            nestedFields,
            nestedField,
            nestedFieldConfiguration.field_path,
            nestedFieldConfiguration.id_field_name,
            nestedFieldConfiguration.base_fields?.map(field => field.field_name),
            nestedFieldConfiguration.pool_ids?.map(pool => pool.pool_id),
            indexerSettings,
            addedIds
        )) changed = true;
    }

    return changed;
}

function getNestedFields(object, nestedFieldPath) {
    const objectData = object[object._objecttype];

    if (nestedFieldPath?.length) {
        return getFieldValues(objectData, nestedFieldPath.split('.'));
    } else {
        return [objectData];
    }
}

function getFieldValues(object, pathSegments) {
    const fieldName = pathSegments.shift();
    const field = object[fieldName];

    if (field === undefined) {
        return [];
    } else if (pathSegments.length === 0) {
        return Array.isArray(field) ? field : [field];
    } else if (Array.isArray(field)) {
        return field.map(entry => getFieldValues(entry, pathSegments.slice()))
            .filter(data => data !== undefined)
            .reduce((result, fieldValues) => result.concat(fieldValues), []);
    } else {
        return getFieldValues(field, pathSegments);
    }
}

async function addId(objectType, nestedFields, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds, indexerSettings, addedIds) {
    if (!idFieldName?.length
        || !baseFieldNames
        || baseFieldNames.find(baseFieldName => !getBaseFieldValue(nestedField, baseFieldName))
        || nestedField[idFieldName]
        || nestedField._uuid) return false;

    const newId = await getIdValue(
        objectType, nestedFields, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds, indexerSettings, addedIds
    );

    nestedField[idFieldName] = newId;
    const path = objectType + (nestedFieldPath ? '.' + nestedFieldPath : '');
    if (!addedIds[path]) addedIds[path] = [];
    addedIds[path].push(newId);

    return true;
}

async function getIdValue(objectType, nestedFields, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds, indexerSettings, addedIds) {
    await assertIndexerIsFree(indexerSettings);
    const existingIdValues = await findExistingIdValues(
        objectType, nestedFields, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds, addedIds
    );
    existingIdValues.sort((value1, value2) => value1 - value2);

    return existingIdValues.length
        ? existingIdValues.pop() + 1
        : 1;
}

async function findExistingIdValues(objectType, nestedFields, nestedField, nestedFieldPath, idFieldName,
                                    baseFieldNames, poolIds, addedIds) {
    const idValuesInCurrentObject = findExistingIdValuesInNestedFields(
        nestedFields, nestedField, idFieldName, baseFieldNames
    );
    const idValuesInOtherObjects = await findExistingIdValuesInOtherObjects(
        objectType, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds
    );
    
    return idValuesInCurrentObject.concat(idValuesInOtherObjects).concat(addedIds[objectType + '.' + nestedFieldPath])
        .filter(value => value);
}

function findExistingIdValuesInNestedFields(nestedFields, nestedField, idFieldName, baseFieldNames) {
    for (let baseFieldName of baseFieldNames) {
        nestedFields = nestedFields.filter(field => {
            return getBaseFieldValue(field, baseFieldName) === getBaseFieldValue(nestedField, baseFieldName);
        });
    }
    
    return nestedFields.map(field => field[idFieldName]);
}

async function findExistingIdValuesInOtherObjects(objectType, nestedField, nestedFieldPath, idFieldName,
                                                  baseFieldNames, poolIds) {
    const objects = await findOtherObjects(objectType, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds);

    return objects.reduce((result, object) => {
        const nestedFields = getNestedFields(object, nestedFieldPath);
        const idValues = findExistingIdValuesInNestedFields(nestedFields, nestedField, idFieldName, baseFieldNames);
        return result.concat(idValues);
    }, []);
}

async function findOtherObjects(objectType, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds, offset = 0) {
    const url = info.api_url + '/api/v1/search?access_token=' + info.api_user_access_token;
    const query = baseFieldNames.map(baseFieldName => getBaseFieldQuery(objectType, nestedField, nestedFieldPath, baseFieldName));
    if (poolIds?.length) {
        query.push({
            type: 'in',
            bool: 'must',
            fields: [objectType + '._pool._path.pool._id'],
            in: poolIds
        });
    }
    const chunkSize = 100;
    const searchRequest = {
        search: query,
        include_fields: ['_objecttype', getFullFieldPath(objectType, nestedField, nestedFieldPath, idFieldName)].concat(
            baseFieldNames.map(baseFieldName => getFullFieldPath(objectType, nestedField, nestedFieldPath, baseFieldName))
        ),
        limit: chunkSize,
        offset
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(searchRequest)
        });
        const result = await response.json();
        return result.count > searchRequest.limit + offset
            ? result.objects.concat(
                await findOtherObjects(
                    objectType, nestedField, nestedFieldPath, idFieldName, baseFieldNames, poolIds, offset + chunkSize
                )
            ) : result.objects;
    } catch (err) {
        throwErrorToFrontend('Suchanfrage fehlgeschlagen', JSON.stringify(err));
    }
}

function getBaseFieldQuery(objectType, nestedField, nestedFieldPath, baseFieldName) {
    return baseFieldName.endsWith('_uuid')
        ? {
            type: 'in',
            bool: 'must',
            fields: [getFullFieldPath(objectType, nestedField, nestedFieldPath, baseFieldName)],
            in: [getBaseFieldValue(nestedField, baseFieldName)]
        } : {
            type: 'match',
            bool: 'must',
            fields: [getFullFieldPath(objectType, nestedField, nestedFieldPath, baseFieldName)],
            string: getBaseFieldValue(nestedField, baseFieldName)
        };
}

function getBaseFieldValue(nestedField, baseFieldName) {
    const fieldValue = getFieldValues(nestedField, baseFieldName.split('.'))?.[0];

    return isDanteConcept(fieldValue)
        ? fieldValue.conceptURI
        : fieldValue;
}

function getFullFieldPath(objectType, nestedField, nestedFieldPath, fieldName) {
    let result = objectType + '.'
        + (nestedFieldPath?.length ? nestedFieldPath + '.' : '')
        + fieldName;
    if (isDanteConcept(nestedField[fieldName])) result += '.conceptURI';

    return result;
}

function isDanteConcept(fieldValue) {
    return fieldValue !== undefined
        && fieldValue !== null
        && typeof fieldValue === 'object'
        && fieldValue.conceptName !== undefined
        && fieldValue.conceptURI !== undefined;
}

async function assertIndexerIsFree(indexerSettings) {
    if (!indexerSettings.maxNotIndexed) return;

    const systemStatusData = await getSystemStatusData();
    const totalNotIndexed = systemStatusData.Stats.total_not_indexed;
    
    if (totalNotIndexed > indexerSettings.maxNotIndexed) {
        throwErrorToFrontend(indexerSettings.errorMessage, undefined, 'objectNotSaved');
    }
}

async function getSystemStatusData() {
    try {
        const response = await fetch('http://fylr.localhost:8082/inspect/system/status/', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        return await response.json();
    } catch (err) {
        throwErrorToFrontend('Systemstatus konnte nicht abgerufen werden', JSON.stringify(err));
    }
}

function throwErrorToFrontend(error, description, realm) {
    console.log(JSON.stringify({
        error: {
            code: 'error.numericIdAutoIncrementer',
            statuscode: 400,
            realm: realm ?? 'api',
            error,
            parameters: {},
            description
        }
    }));

    process.exit(0);
}
