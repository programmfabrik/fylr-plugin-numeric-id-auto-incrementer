async function isRejectedByWorkflow(workflows, object, objectTypes, user) {
    return workflows.some(workflow => isRejectingWorkflow(workflow, object, objectTypes, user));
}

function isRejectingWorkflow(workflow, object, objectTypes, user) {
    return checkType(workflow)
        && checkOperations(workflow, object)
        && checkObjectType(workflow, object, objectTypes)
        && checkUserRights(workflow, user)
        && checkTags(workflow, object);
}

function checkType(workflow) {
    return workflow.type === 'reject';
}

function checkOperations(workflow, object) {
    return object._current
        ? workflow.operations.includes('UPDATE')
        : workflow.operations.includes('INSERT');
}

function checkObjectType(workflow, object, objectTypes) {
    if (!workflow.objecttype_ids?.length) return true;

    const objectTypeId = objectTypes.find(entry => entry.objecttype.name === object._objecttype)?.objecttype._id;
    return workflow.objecttype_ids.includes(objectTypeId);
}

function checkUserRights(workflow, user) {
    if (!workflow.who?.length) return true;

    return hasUserRights(workflow, user)
        ? !workflow.who_not
        : workflow.who_not;
}

function hasUserRights(workflow, user) {
    const userGroupIds = user._groups.map(entry => entry.group._id);

    return workflow.who.some(entry => {
        return entry.group
            ? userGroupIds.find(id => id === entry.group._id)
            : entry.user._id === user.user._id;
    });
}

function checkTags(workflow, object) {
    const currentTagIds = object._current?._tags?.map(tag => tag._id) ?? [];
    const changedTagIds = object._tags.map(tag => tag._id);

    return checkTagFilters(workflow['tagfilter:before'], currentTagIds)
        && checkTagFilters(workflow['tagfilter:after'], changedTagIds)
        && checkChangedTagFilter(workflow['tagfilter:after'].changed, currentTagIds, changedTagIds);
}

function checkTagFilters(tagFilters, objectTagIds) {
    return checkAnyTagFilter(tagFilters.any, objectTagIds)
        && checkAllTagFilter(tagFilters.all, objectTagIds)
        && checkNotTagFilter(tagFilters.not, objectTagIds);
}

function checkAnyTagFilter(filterTagIds, objectTagIds) {
    return !filterTagIds?.length
        || filterTagIds.some(filterTagId => objectTagIds.find(objectTagId => objectTagId === filterTagId));
}

function checkAllTagFilter(filterTagIds, objectTagIds) {
    return !filterTagIds?.length
        || filterTagIds.every(filterTagId => objectTagIds.find(objectTagId => objectTagId === filterTagId));
}

function checkNotTagFilter(filterTagIds, objectTagIds) {
    return !filterTagIds?.length
        || !filterTagIds.some(filterTagId => objectTagIds.find(objectTagId => objectTagId === filterTagId));
}

function checkChangedTagFilter(filterTagIds, currentTagIds, changedTagIds) {
    return !filterTagIds?.length
        || filterTagIds.some(id => currentTagIds.includes(id) !== changedTagIds.includes(id));
}
