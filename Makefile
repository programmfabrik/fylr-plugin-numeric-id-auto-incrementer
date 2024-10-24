PLUGIN_NAME = numeric-id-auto-incrementer
ZIP_NAME = "NumericIdAutoIncrementer.zip"

SERVER_FILE = setIds.js

all: build zip

build: clean
	mkdir -p build
	mkdir -p build/$(PLUGIN_NAME)
	mkdir -p build/$(PLUGIN_NAME)/server
	mkdir -p build/$(PLUGIN_NAME)/l10n

	cp src/server/${SERVER_FILE} build/${PLUGIN_NAME}/server/${SERVER_FILE}
	cp l10n/$(PLUGIN_NAME).csv build/$(PLUGIN_NAME)/l10n/$(PLUGIN_NAME).csv
	cp manifest.master.yml build/$(PLUGIN_NAME)/manifest.yml

clean:
	rm -rf build

zip:
	cd build && zip $(ZIP_NAME) -r $(PLUGIN_NAME)/
	cp -r build/$(PLUGIN_NAME)/* build/
	rm -rf build/${PLUGIN_NAME}
