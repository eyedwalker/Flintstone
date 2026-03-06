# SAM build targets — expects `npm run build` to have been run first.
# Usage: npm run build && sam build && sam deploy

.PHONY: build-ApiFunction build-ProvisionFunction

build-ApiFunction:
	cp -r dist "$(ARTIFACTS_DIR)/dist"
	cp package.json package-lock.json "$(ARTIFACTS_DIR)/"
	cd "$(ARTIFACTS_DIR)" && npm ci --omit=dev --ignore-scripts

build-ProvisionFunction:
	cp -r dist "$(ARTIFACTS_DIR)/dist"
	cp package.json package-lock.json "$(ARTIFACTS_DIR)/"
	cd "$(ARTIFACTS_DIR)" && npm ci --omit=dev --ignore-scripts
