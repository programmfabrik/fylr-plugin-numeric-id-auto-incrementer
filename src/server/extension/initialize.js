const info = process.argv.length >= 3
    ? JSON.parse(process.argv[2])
    : {};

let input = '';

process.stdin.on('data', d => {
    try {
        input += d.toString();
    } catch (e) {
        console.error(`Could not read input into string: ${e.message}`, e.stack);
        process.exit(1);
    }
});

process.stdin.on('end', async () => {
    const result = await handleRequest();
    console.log(JSON.stringify(result, null, 2));
});

async function handleRequest() {
    try {
        if (await isIndexerBusy()) {
            return { success: false, error: 'Initialisierung während laufender Indexierung nicht möglich' };
        }

        const incrementerMap = await buildIncrementerMap();
        await saveIncrementerMap(incrementerMap);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error?.message
                ? { message: error.message, code: error.code, stack: error.stack, cause: error.cause }
                : error
        };
    }
}

async function buildIncrementerMap() {
    const result = {};
    const configuration = getPluginConfiguration();

    for (let objectType of getObjectTypes(configuration)) {
        let objects;
        let offset = 0;
        const batchSize = 1000;
        do {
            objects = await fetchObjects(objectType, batchSize, offset);
            offset += batchSize;

            for (let object of objects) {
                for (let incrementerConfiguration of configuration.incrementers) {
                    if (!incrementerConfiguration.object_types.map(objectType => objectType.name).includes(objectType)
                        || (incrementerConfiguration.pool_ids?.length
                            && !incrementerConfiguration.pool_ids.includes(object[object._objecttype]._pool.pool._id))) {
                        continue;
                    }

                    result[incrementerConfiguration.incrementer_id] = updateIdValues(
                        getNestedFieldEntries(object, incrementerConfiguration.field_path),
                        incrementerConfiguration.id_field_name,
                        incrementerConfiguration.base_fields?.map(field => field.field_name),
                        result[incrementerConfiguration.incrementer_id] ?? {}
                    );
                }
            }
        } while (objects?.length);
    }

    return result;
}

function getObjectTypes(configuration) {
    return configuration.incrementers.reduce((result, incrementerConfiguration) => {
        incrementerConfiguration.object_types.map(objectType => objectType.name)
            .forEach(objectType => {
                if (objectType && !result.includes(objectType)) result.push(objectType);
            });

        return result;
    }, []);
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

function getBaseFieldValue(nestedField, baseFieldName) {
    const fieldValue = getFieldValues(nestedField, baseFieldName.split('.'))?.[0];

    return isDanteConcept(fieldValue)
        ? fieldValue.conceptURI
        : fieldValue;
}

function isDanteConcept(fieldValue) {
    return fieldValue !== undefined
        && fieldValue !== null
        && typeof fieldValue === 'object'
        && fieldValue.conceptName !== undefined
        && fieldValue.conceptURI !== undefined;
}

async function saveIncrementerMap(incrementerMap) {
    const incrementerObjectType = getPluginConfiguration().incrementer_object_type;
    const incrementers = await fetchObjects(incrementerObjectType, 1000, 0);
    
    for (let incrementerId of Object.keys(incrementerMap)) {
        let incrementer = incrementers.find(existingIncrementer => {
            return existingIncrementer[incrementerObjectType].incrementer_id === incrementerId;
        });

        if (!incrementer) {
            incrementer = {
                '_objecttype': incrementerObjectType,
                '_mask': incrementerObjectType + '__all_fields'
            }
            incrementer[incrementerObjectType] = {
                incrementer_id: incrementerId
            };
        }

        incrementer[incrementerObjectType].incrementer_map = JSON.stringify(incrementerMap[incrementerId]);
        await saveObject(incrementer);
    }
}

function getPluginConfiguration() {
    return info.config.plugin['numeric-id-auto-incrementer'].config.numericIdAutoIncrementer;
}

async function fetchObjects(objectType, limit, offset) {
    const url = info.api_url + '/api/v1/db/' + objectType + '/_all_fields/list?version=current&limit=' + limit
        + '&offset=' + offset + '&access_token=' + info.api_user_access_token;

    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw 'Fehler bei der Abfrage von Objekten des Typs ' + objectType;

    return response.json();
}

async function fetchObject(objectType, mask, id) {
    const url = info.api_url + '/api/v1/db/' + objectType + '/' + mask + '/' + id + '?access_token=' + info.api_user_access_token;

    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw 'Fehler bei der Abfrage des Objekts ' + id;

    const result = await response.json();

    return result?.length
        ? result[0]
        : undefined;
}

async function saveObject(object) {
    const url = info.api_url + '/api/v1/db/' + object._objecttype + '?access_token=' + info.api_user_access_token;

    const data = object[object._objecttype];
    data._version = data._version ? data._version += 1 : 1;

    const response = await fetch(url, { method: 'POST', body: JSON.stringify([object]) });
    return response.json();
}

async function isIndexerBusy() {
    const systemStatusData = await getSystemStatusData();
    return systemStatusData.Stats.total_not_indexed > 0;
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
