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
    return data.info.config.plugin['counter'].config.counter;
}

async function processObject(object, configuration) {
    const nestedFieldsConfiguration = getNestedFieldsConfiguration(configuration, object._objecttype);
    let changed = false;

    for (let nestedFieldConfiguration of nestedFieldsConfiguration) {
        if (await processNestedFields(object, nestedFieldConfiguration)) changed = true;
    }

    return changed;
}

function getNestedFieldsConfiguration(configuration, objectType) {
    return configuration.object_types
        ?.find(configuration => configuration.name === objectType)
        ?.nested_fields ?? [];
}

async function processNestedFields(object, nestedFieldConfiguration) {
    const nestedFields = getFieldValues(
        object[object._objecttype],
        nestedFieldConfiguration.field_path
    );
    let changed = false;

    for (let nestedField of nestedFields) {
        if (await addCounterValue(
            object._objecttype,
            nestedFields,
            nestedField,
            nestedFieldConfiguration.field_path,
            nestedFieldConfiguration.counter_field_name,
            nestedFieldConfiguration.base_fields?.map(field => field.field_name),
        )) changed = true;
    }

    return changed;
}

function getFieldValues(object, fieldPath) {
    const pathSegments = fieldPath.split('.');
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

async function addCounterValue(objectType, nestedFields, nestedField, nestedFieldPath, counterFieldName, baseFieldNames) {
    if (!counterFieldName?.length
        || !baseFieldNames
        || baseFieldNames.find(baseFieldName => !nestedField[baseFieldName])
        || nestedField[counterFieldName]) return false;

    nestedField[counterFieldName] = await getCounterValue(
        objectType, nestedFields, nestedField, nestedFieldPath, counterFieldName, baseFieldNames
    );

    return true;
}

async function getCounterValue(objectType, nestedFields, nestedField, nestedFieldPath, counterFieldName, baseFieldNames) {
    const existingCounterValues = await findExistingCounterValues(
        objectType, nestedFields, nestedField, nestedFieldPath, counterFieldName, baseFieldNames
    );
    existingCounterValues.sort();

    return existingCounterValues.length
        ? existingCounterValues.pop() + 1
        : 1;
}

async function findExistingCounterValues(objectType, nestedFields, nestedField, nestedFieldPath, counterFieldName,
                                         baseFieldNames) {
    const counterValuesInCurrentObject = findExistingCounterValuesInNestedFields(
        nestedFields, nestedField, counterFieldName, baseFieldNames
    );
    const counterValuesInOtherObjects = await findExistingCounterValuesInOtherObjects(
        objectType, nestedField, nestedFieldPath, counterFieldName, baseFieldNames
    );
    
    return counterValuesInCurrentObject.concat(counterValuesInOtherObjects)
        .filter(value => value);
}

function findExistingCounterValuesInNestedFields(nestedFields, nestedField, counterFieldName, baseFieldNames) {
    for (let baseFieldName of baseFieldNames) {
        nestedFields = nestedFields.filter(field => {
            return getBaseFieldValue(field, baseFieldName) === getBaseFieldValue(nestedField, baseFieldName);
        });
    }
    
    return nestedFields.map(field => field[counterFieldName])
}

async function findExistingCounterValuesInOtherObjects(objectType, nestedField, nestedFieldPath, counterFieldName,
                                                       baseFieldNames) {
    const url = info.api_url + '/api/v1/search?access_token=' + info.api_user_access_token;
    const searchRequest = {
        search: baseFieldNames.map(baseFieldName => {
            return {
                type: 'match',
                bool: 'must',
                fields: [getFullFieldPath(objectType, nestedField, nestedFieldPath, baseFieldName)],
                string: getBaseFieldValue(nestedField, baseFieldName)
            };
        }),
        include_fields: [objectType + '.' + nestedFieldPath + '.' + counterFieldName].concat(
            baseFieldNames.map(baseFieldName => getFullFieldPath(objectType, nestedField, nestedFieldPath, baseFieldName))
        )
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

        return result.objects.reduce((result, object) => {
            const counterValues = findExistingCounterValuesInNestedFields(
                getFieldValues(object[objectType], nestedFieldPath), nestedField, counterFieldName, baseFieldNames
            );
            return result.concat(counterValues);
        }, []);
    } catch (err) {
        throwErrorToFrontend('Search request failed', JSON.stringify(err));
    }
}

function getBaseFieldValue(nestedField, baseFieldName) {
    const fieldValue = nestedField[baseFieldName];

    return isDanteConcept(fieldValue)
        ? fieldValue.conceptURI
        : fieldValue;
}

function getFullFieldPath(objectType, nestedField, nestedFieldPath, baseFieldName) {
    let result = objectType + '.' + nestedFieldPath + '.' + baseFieldName;
    if (isDanteConcept(nestedField[baseFieldName])) result += '.conceptURI';

    return result;
}

function isDanteConcept(fieldValue) {
    return typeof fieldValue === 'object'
        && fieldValue.conceptName !== undefined
        && fieldValue.conceptURI !== undefined;
}

function throwErrorToFrontend(error, description) {
    console.log(JSON.stringify({
        error: {
            code: 'error.counter',
            statuscode: 400,
            realm: 'api',
            error,
            parameters: {},
            description
        }
    }));

    process.exit(0);
}
