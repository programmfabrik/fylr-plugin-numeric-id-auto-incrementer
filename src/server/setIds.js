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

    for (let object of data.objects) {
        if (await processObject(object, configuration)) changedObjects.push(object);
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

async function processObject(object, configuration) {
    const incrementerConfigurations = configuration.incrementers;
    let changed = false;

    for (let incrementerConfiguration of incrementerConfigurations) {
        if (!isConfiguredObjectType(object, incrementerConfiguration) || !isInConfiguredPool(object, incrementerConfiguration)) continue;
        if (await processNestedFields(object, incrementerConfiguration, configuration, configuration.incrementer_object_type)) changed = true;
    }

    return changed;
}

function isInConfiguredPool(object, incrementerConfiguration) {
    const poolIds = incrementerConfiguration.pool_ids?.map(pool => pool.pool_id);
    if (!poolIds?.length) return true;

    if (!object[object._objecttype]._pool) return false;
    
    for (let objectPool of object[object._objecttype]._pool._path) {
        if (poolIds.includes(objectPool.pool._id.toString())) return true;
    }

    return false;
}

function isConfiguredObjectType(object, incrementerConfiguration) {
    return incrementerConfiguration.object_types.map(objectType => objectType.name)
        .includes(object._objecttype);
}

async function processNestedFields(object, incrementerConfiguration, configuration, incrementerObjectType) {
    const nestedFieldEntries = getNestedFieldEntries(object, incrementerConfiguration.field_path);

    let changed = false;
    for (let entry of nestedFieldEntries) {
        if (await addId(
            incrementerConfiguration.incrementer_id,
            incrementerObjectType,
            entry,
            incrementerConfiguration.id_field_name,
            incrementerConfiguration.base_fields?.map(field => field.field_name),
            configuration
        )) changed = true;
    }

    return changed;
}

async function addId(incrementerId, incrementerObjectType, nestedField, idFieldName, baseFieldNames, configuration) {
    if (!idFieldName?.length
        || !baseFieldNames
        || baseFieldNames.find(baseFieldName => !getBaseFieldValue(nestedField, baseFieldName))
        || nestedField[idFieldName]
        || nestedField._uuid) return false;

    nestedField[idFieldName] = await getIdValue(incrementerId, incrementerObjectType, nestedField, baseFieldNames, configuration);

    return true;
}

async function getIdValue(incrementerId, incrementerObjectType, nestedField, baseFieldNames, configuration) {
    const baseValue = getBaseValue(nestedField, baseFieldNames);
    
    let id;
    let attempts = 10;

    while (attempts > 0) {
        try {
            const incrementer = await getIncrementer(incrementerId, incrementerObjectType, configuration);
            const incrementerMap = getIncrementerMap(incrementer, configuration);

            const currentId = incrementerMap[baseValue];
            id = currentId ? currentId + 1 : 1;
            incrementerMap[baseValue] = id;

            await updateIncrementerMap(incrementer, incrementerMap, configuration);
            break;
        } catch (err) {
            attempts--;
        }
    }

    if (attempts > 0) {
        return id;   
    } else {
        throwErrorToFrontend('Das Objekt konnte nicht gespeichert werden. Bitte versuchen Sie es zu einem späteren Zeitpunkt erneut.')
    }
}

function getBaseValue(nestedField, baseFieldNames) {
    return baseFieldNames.reduce((result, baseFieldName) => {
        const baseFieldValue = getBaseFieldValue(nestedField, baseFieldName);
        result.push(baseFieldValue ?? '');
        return result;
    }, []).join('|||');
}

async function getIncrementer(incrementerId, incrementerObjectType, configuration) {
    const incrementerIdFieldName = configuration.incrementer_id_field_name;
    const incrementerMask = configuration.incrementer_mask;
    const incrementers = await fetchObjects(incrementerObjectType, incrementerMask);
    return incrementers.find(incrementer => incrementer[incrementerObjectType][incrementerIdFieldName] === incrementerId);
}

function getIncrementerMap(incrementer, configuration) {
    const incrementerValuesFieldName = configuration.incrementer_values_field_name;
    return JSON.parse(incrementer[incrementer._objecttype][incrementerValuesFieldName]);
}

async function updateIncrementerMap(incrementer, incrementerMap, configuration) {
    const incrementerValuesFieldName = configuration.incrementer_values_field_name;
    incrementer[incrementer._objecttype][incrementerValuesFieldName] = JSON.stringify(incrementerMap);
    await saveObject(incrementer);
}

async function fetchObjects(objectType, mask) {
    const url = info.api_url + '/api/v1/db/' + objectType + '/' + mask + '/list?access_token=' + info.api_user_access_token;

    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throwErrorToFrontend('Fehler bei der Abfrage von Objekten des Typs ' + objectType);

    const objects = await response.json();
    return objects.filter(object => object._latest_version && !object._latest_version_deleted_at);
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
