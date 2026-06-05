const fylrUrl = process.argv[2];
const accessToken = process.argv[3];

async function start() {
    try {
        if (await isIndexerBusy()) throw 'Initializing not possible during active indexing process';

        const configuration = await getPluginConfiguration();
        const incrementerMap = await buildIncrementerMap(configuration);
        await saveIncrementerMap(incrementerMap, configuration);
    } catch (err) {
        console.error(err);
    }
}

async function getPluginConfiguration() {
    const configuration = await getConfiguration();
    return configuration.BaseConfigList.find(section => section.Name === 'numericIdAutoIncrementer').Values;
}

async function getConfiguration() {
    const url = fylrUrl + '/inspect/config?access_token=' + accessToken;
    const headers = { 'Accept': 'application/json' };

    return (await fetch(url, { headers })).json();
}

async function buildIncrementerMap(configuration) {
    const result = {};

    for (let incrementerConfiguration of configuration.incrementers.ValueTable) {
        result[incrementerConfiguration.incrementer_id.ValueText] = {};
    }

    for (let objectType of getObjectTypes(configuration)) {
        let objects;
        let offset = 0;
        const batchSize = 1000;
        do {
            objects = await fetchObjects(objectType, batchSize, offset);
            offset += batchSize;

            for (let object of objects) {
                console.log(objectType + ' ' +  object[objectType]._id);
                for (let incrementerConfiguration of configuration.incrementers.ValueTable) {
                    if (!isAllowedObjectType(objectType, incrementerConfiguration) || !isInAllowedPool(object, incrementerConfiguration)) {
                        continue;
                    }

                    result[incrementerConfiguration.incrementer_id.ValueText] = updateIdValues(
                        getNestedFieldEntries(object, incrementerConfiguration.field_path.ValueText),
                        incrementerConfiguration.id_field_name.ValueText,
                        incrementerConfiguration.base_fields?.ValueTable?.map(field => field.field_name.ValueText) ?? [],
                        result[incrementerConfiguration.incrementer_id.ValueText]
                    );
                }
            }
        } while (objects?.length);
    }

    return result;
}

function isAllowedObjectType(objectType, incrementerConfiguration) {
    return incrementerConfiguration.object_types.ValueTable.map(objectType => objectType.name.ValueText).includes(objectType)
}

function isInAllowedPool(object, incrementerConfiguration) {
    if (!incrementerConfiguration.pool_ids?.ValueTable?.length) return true;
    
    const allowedPoolIds = incrementerConfiguration.pool_ids.ValueTable.map(entry => parseInt(entry.pool_id.ValueText));
    return object[object._objecttype]._pool?._path.find(pool => allowedPoolIds.includes(pool.pool._id));
}

function getObjectTypes(configuration) {
    return configuration.incrementers.ValueTable.reduce((result, incrementerConfiguration) => {
        incrementerConfiguration.object_types.ValueTable.map(objectType => objectType.name.ValueText)
            .forEach(objectType => {
                if (objectType && !result.includes(objectType)) result.push(objectType);
            });

        return result;
    }, []);
}

function updateIdValues(nestedFieldEntries, idFieldName, baseFieldNames, idValues) {
    return nestedFieldEntries.reduce((result, entry) => {
        const baseFieldsString = baseFieldNames.map(baseFieldName => {
            return getBaseFieldValue(entry, baseFieldName) ?? '';
        }).join('|||');

        if (entry[idFieldName] && (!result[baseFieldsString] || result[baseFieldsString] < entry[idFieldName])) {
            result[baseFieldsString] = entry[idFieldName];
        }

        return result;
    }, idValues);
}

async function saveIncrementerMap(incrementerMap, configuration) {
    console.log('Saving incrementer objects...');

    const incrementerObjectType = configuration.incrementer_object_type.ValueText;
    const incrementerIdFieldName = configuration.incrementer_id_field_name.ValueText;
    const incrementerValuesFieldName = configuration.incrementer_values_field_name.ValueText;
    const incrementerMask = configuration.incrementer_mask.ValueText;

    const incrementers = await fetchObjects(incrementerObjectType, 1000, 0);
    
    for (let incrementerId of Object.keys(incrementerMap)) {
        let incrementer = incrementers.find(existingIncrementer => {
            return existingIncrementer[incrementerObjectType][incrementerIdFieldName] === incrementerId;
        });

        if (!incrementer) {
            incrementer = {
                '_objecttype': incrementerObjectType,
                '_mask': incrementerMask
            }
            incrementer[incrementerObjectType] = {};
            incrementer[incrementerObjectType][incrementerIdFieldName] = incrementerId;
        }

        incrementer[incrementerObjectType][incrementerValuesFieldName] = JSON.stringify(incrementerMap[incrementerId]);
        await saveObject(incrementer);
    }
}

async function fetchObjects(objectType, limit, offset) {
    const url = fylrUrl + '/api/v1/db/' + objectType + '/_all_fields/list?limit=' + limit
        + '&offset=' + offset + '&access_token=' + accessToken;

    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw 'Failed to fetch objects of type ' + objectType;

    const objects = await response.json();
    return objects.filter(object => object._latest_version && !object._latest_version_deleted_at);
}

async function isIndexerBusy() {
    const systemStatusData = await getSystemStatusData();
    return systemStatusData.Stats.total_not_indexed > 0;
}

async function getSystemStatusData() {
    const response = await fetch(fylrUrl + '/inspect/system/status?access_token=' + accessToken, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    });

    try {
        return await response.json();
    } catch (err) {
        throw 'Failed to retrieve system status data. Please check the access token.';
    }
}

function getBaseFieldValue(nestedField, baseFieldName) {
    const fieldValue = getFieldValues(nestedField, baseFieldName.split('.'))?.[0];

    return isDanteConcept(fieldValue)
        ? fieldValue.conceptURI
        : isEmptyObject(fieldValue)
            ? ''
            : fieldValue;
}

function getNestedFieldEntries(object, nestedFieldPath) {
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

function isDanteConcept(fieldValue) {
    return fieldValue !== undefined
        && fieldValue !== null
        && typeof fieldValue === 'object'
        && fieldValue.conceptName !== undefined
        && fieldValue.conceptURI !== undefined;
}

function isEmptyObject(fieldValue) {
     return fieldValue !== undefined
        && fieldValue !== null
        && typeof fieldValue === 'object'
        && !Object.keys(fieldValue).length;
}

async function saveObject(object) {
    const url = fylrUrl + '/api/v1/db/' + object._objecttype + '?access_token=' + accessToken;

    const data = object[object._objecttype];
    data._version = data._version ? data._version += 1 : 1;

    const response = await fetch(url, { method: 'POST', body: JSON.stringify([object]) });
    if (!response.ok) {
        try {
            console.error(await response.json());
        } catch {
            console.error(await response.text());
        }
        throw response.status;
    }

    return response.json();
}

start(() => process.exit());
