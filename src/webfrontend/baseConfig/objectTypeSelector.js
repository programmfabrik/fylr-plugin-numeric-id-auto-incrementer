var ObjectTypeSelector;
var extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };
var hasProp = {}.hasOwnProperty;

ObjectTypeSelector = (function(superClass) {
    extend(ObjectTypeSelector, superClass);

    function ObjectTypeSelector() {
        return ObjectTypeSelector.__super__.constructor.apply(this, arguments);
    }

    const Plugin = ObjectTypeSelector.prototype;

    Plugin.getFieldDefFromParm = function(_, name, def, __) {
        if (def.plugin_type !== 'objectTypeSelector') return;

        const options = ez5.schema.CURRENT._objecttypes.map(objectTypeConfiguration => {
            const objectType = new Objecttype(new Table('CURRENT', objectTypeConfiguration.table_id))
        
            return {
                text: objectType.nameLocalized() + ' [' + objectType.name() + ']',
                value: objectTypeConfiguration.name
             };
        }); 

        return {
            type: CUI.Select,
            name,
            options
        }
    };
    
    return ObjectTypeSelector;
})(BaseConfigPlugin);

BaseConfig.registerPlugin(new ObjectTypeSelector());
