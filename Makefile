PLUGIN_NAME = numeric-id-auto-incrementer
ZIP_NAME = "NumericIdAutoIncrementer.zip"

SERVER_FILE = setIds.js

all: build zip

build: clean buildinfojson
	mkdir -p build
	mkdir -p build/$(PLUGIN_NAME)
	mkdir -p build/$(PLUGIN_NAME)/server
	mkdir -p build/$(PLUGIN_NAME)/l10n

	cp src/server/${SERVER_FILE} build/${PLUGIN_NAME}/server/${SERVER_FILE}
	cp l10n/$(PLUGIN_NAME).csv build/$(PLUGIN_NAME)/l10n/$(PLUGIN_NAME).csv
	cp manifest.master.yml build/$(PLUGIN_NAME)/manifest.yml
	cp build-info.json build/$(PLUGIN_NAME)/build-info.json

clean:
	rm -rf build

zip:
	cd build && zip $(ZIP_NAME) -r $(PLUGIN_NAME)/
	cp -r build/$(PLUGIN_NAME)/* build/
	rm -rf build/${PLUGIN_NAME}

buildinfojson:
	repo=`git remote get-url origin | sed -e 's/\.git$$//' -e 's#.*[/\\]##'` ;\
	rev=`git show --no-patch --format=%H` ;\
	lastchanged=`git show --no-patch --format=%ad --date=format:%Y-%m-%dT%T%z` ;\
	builddate=`date +"%Y-%m-%dT%T%z"` ;\
	echo '{' > build-info.json ;\
	echo '  "repository": "'$$repo'",' >> build-info.json ;\
	echo '  "rev": "'$$rev'",' >> build-info.json ;\
	echo '  "lastchanged": "'$$lastchanged'",' >> build-info.json ;\
	echo '  "builddate": "'$$builddate'"' >> build-info.json ;\
	echo '}' >> build-info.json
