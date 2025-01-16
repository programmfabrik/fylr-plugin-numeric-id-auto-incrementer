> This Plugin / Repo is being maintained by a community of developers.
There is no warranty given or bug fixing guarantee; especially not by
Programmfabrik GmbH. Please use the GitHub issue tracking to report bugs
and self organize bug fixing. Feel free to directly contact the committing
developers.

# Numeric ID auto incrementer plugin

This server plugin for [fylr](https://docs.fylr.io) allows automatically setting the values of numeric ID fields when saving data. IDs are assigned in numerical order starting from 1 for each combination of values present in a defined set of base fields (see example below). Please note that the ID field as well as all base fields are expected to be grouped inside the same nested field.

## Installation

The latest version of this plugin can be found [here](https://github.com/programmfabrik/fylr-plugin-numeric-id-auto-incrementer/releases/latest/download/NumericIdAutoIncrementer.zip).

The ZIP can be downloaded and installed using the plugin manager, or used directly (recommended).

## Configuration

All plugin configuration takes place in base configuration.

* *Object types*:
    * *Object type name*: The name of the object type for which to set up ID generation
    * *Parent nested fields*:
        * *Path to parent field*: The path to the nested field that contains the ID field and the base fields.
        * *ID field name*: The name of the ID field to be filled out by the plugin. This has to be a numeric field. The field will only be updated if it is empty, if the parent field has been newly created and if all base fields have been filled out by the user.
        * *Base field names*: The names of the base fields to consider when setting the ID. These can be text fields or fields of the [custom data type DANTE](https://github.com/programmfabrik/fylr-plugin-custom-data-type-dante).
        * *IDs of pools to consider*: If not empty, IDs are only updated for resources in the specified pools (and their child pools). Also, resources in other pools are not considered during ID generation.

## Example

### Configuration

* *Object type name*: example
* *Path to parent field*: _nested:example__parent
* *ID field name*: id
* *Base field names*: place, year

### Result

The field "id" contains the respective value as generated by the plugin.

Object 1:

    {
        "_nested:example__parent": [
            { "place": "London", "year": "2020", "id": 1 },
            { "place": "Berlin", "year": "2020", "id": 1 },
            { "place": "Berlin", "year": "2020", "id": 2 }
        ]
    }

Object 2:

    {
        "_nested:example__parent": [
            { "place": "London", "year": "2020", "id": 2 },
            { "place": "Berlin", "year": "2020", "id": 3 }
            { "place": "Berlin", "year": "2021", "id": 1 }
        ]
    }
