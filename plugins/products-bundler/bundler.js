const availableMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const X_BUNDLES_KEY = 'x-bundles';

function getProductMappingToBundle(definitionRoot, resolve, report) {
  if (!('REBILLY_API_PRODUCT' in process.env) || !process.env.REBILLY_API_PRODUCT) {
    return;
  }

  const requestedProduct = process.env.REBILLY_API_PRODUCT;

  if (!(X_BUNDLES_KEY in definitionRoot)) {
    report({message: `"${X_BUNDLES_KEY}" is not set in the specification`});

    return;
  }

  if (!(requestedProduct in definitionRoot[X_BUNDLES_KEY])) {
    report({message: `Product "${requestedProduct}" is not set in the "${X_BUNDLES_KEY}" config`});

    return;
  }

  const productConfiguration = definitionRoot[X_BUNDLES_KEY][requestedProduct];

  return resolve(productConfiguration).node;
}

/** @type {import('@redocly/openapi-cli').CustomRulesConfig} */
const decorators = {
  oas3: {
    'bundle': () => {
      return {
        DefinitionRoot: {
          leave(definitionRoot, {report, resolve}) {
            const productMapping = getProductMappingToBundle(definitionRoot, resolve, report);
            if (!productMapping) {
              // Use default bundling settings
              return;
            }

            // Determine tags names participating in a result bundle of a requested product
            let tagsNamesToInclude = [];
            productMapping['x-tagGroups'].forEach((tagGroup) => {
              tagsNamesToInclude = tagsNamesToInclude.concat(tagGroup.tags);
            });

            // Override original definitions with the requested product settings
            definitionRoot['info'] = getNewInfo(definitionRoot['info'], productMapping);
            definitionRoot['tags'] = getNewTags(definitionRoot, tagsNamesToInclude);
            definitionRoot['x-tagGroups'] = productMapping['x-tagGroups'];
            definitionRoot['paths'] = getNewPaths(definitionRoot['paths'], resolve, tagsNamesToInclude, availableMethods);
            definitionRoot['x-webhooks'] = getNewPaths(definitionRoot['x-webhooks'], resolve, tagsNamesToInclude, ['post']);
            definitionRoot['components'] = getNewComponents(definitionRoot);
            delete definitionRoot[X_BUNDLES_KEY];
          }
        }
      }
    },
  },
};

function getNewTags(definitionRoot, tagsNamesToInclude) {
  const newTags = [];
  definitionRoot.tags.forEach((tag) => {
    if (tagsNamesToInclude.indexOf(tag.name) !== -1) {
      newTags.push(tag)
    }
  });
  return newTags;
}

function getNewPaths(paths, resolve, tagsNamesToInclude, availableMethods) {
  if (!paths) {
    return {};
  }
  const newPaths = {};
  for (const [path, definitionRef] of Object.entries(paths)) {
    let hasAtLeastOneOperation = false;
    const definition = resolve(definitionRef).node;
    availableMethods.forEach((method) => {
      if (!(method in definition)) {
        // Method not defined for path, skipping
        return;
      }

      const operation = definition[method];
      if (!('tags' in operation)) {
        // Operation has no tags specified, excluding as tags must be defined explicitly
        return;
      }

      const requiredTags = operation.tags.filter((tagName) => tagsNamesToInclude.indexOf(tagName) !== -1)
      if (requiredTags.length !== 0) {
        // Remove tags that are not participating in any of tag groups of a requested products
        operation.tags = requiredTags;
        hasAtLeastOneOperation = true;
      } else {
        delete definition[method];
      }
    });

    if (hasAtLeastOneOperation) {
      newPaths[path] = definition;
    }
  }

  return newPaths;
}

function getNewInfo(info, productMapping) {
  if ('info' in productMapping) {
    for (const [property, value] of Object.entries(productMapping.info)) {
      info[property] = value;
    }
  }

  return info;
}

function getNewComponents(definitionRoot) {
  function findUsedComponents(knownComponents, definitionRoot, element) {
    const regexp = new RegExp('#/components/([-a-zA-Z0-9]+)/([-a-zA-Z0-9]+)', 'gim')
    const entries = [...JSON.stringify(element).matchAll(regexp)];
    entries.forEach((entry) => {
      const componentType = entry[1];
      const name = entry[2];
      if (componentType in knownComponents && knownComponents[componentType].indexOf(name) !== -1) {
        return;
      }
      if (!(componentType in knownComponents)) {
        knownComponents[componentType] = [];
      }
      knownComponents[componentType].push(name);
      findUsedComponents(knownComponents, definitionRoot, definitionRoot['components'][componentType][name])
    })
  }

  const sectionsToCheck = [definitionRoot['paths'], definitionRoot['info']];
  if ('x-webhooks' in definitionRoot) {
    sectionsToCheck.push(definitionRoot['x-webhooks']);
  }
  let usedComponents = {};
  sectionsToCheck.forEach((element) => {
    findUsedComponents(usedComponents, definitionRoot, element);
  })

  const newComponents = {
    securitySchemes: definitionRoot.components.securitySchemes,
  };

  for (const [componentType, names] of Object.entries(usedComponents)) {
    newComponents[componentType] = {};
    names.forEach((name) => {
      newComponents[componentType][name] = definitionRoot.components[componentType][name]
    })
  }

  return newComponents;
}

module.exports = {
  id: 'products-bundler',
  decorators,
};
