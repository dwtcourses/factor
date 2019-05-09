const path = require("path")
const { resolve } = path
module.exports = Factor => {
  return new (class {
    constructor() {
      const gen = Factor.$paths.get("generated")

      this.namespace = "factor"

      this.build = process.env.NODE_ENV === "production" ? "production" : "development"

      Factor.$paths.add({
        "plugins-loader-app": resolve(gen, "load-plugins-app.js"),
        "plugins-loader-build": resolve(gen, "load-plugins-build.js"),
        "plugins-loader-cloud": resolve(gen, "load-plugins-cloud.js"),
        "app-package": resolve(Factor.$paths.get("app"), "package.json")
      })

      if (Factor.FACTOR_ENV == "build") {
        this.addWatchers()

        Factor.$filters.add("cli-create-loaders", (_, program) => {
          this.generateLoaders()
        })
      }
    }

    addWatchers() {
      // Factor.$filters.add("after-build-config", () => {
      //   const res = this.generateLoaders()
      //   Factor.$log.success(res)
      // })
      // Factor.$filters.add("cli-tasks", _ => {
      //   _.push({
      //     command: (ctx, task) => {
      //       task.title = this.generateLoaders()
      //     },
      //     title: "Generating extension loaders"
      //   })
      //   return _
      // })
      // Factor.$filters.add("build-watchers", _ => {
      //   _.push({
      //     name: "Generate Loaders - Package Added/Removed",
      //     files: this.getExtensionPatterns(),
      //     ignored: [],
      //     callback: ({ event, path }) => {
      //       // Any time there is a node_modules within a @factor package
      //       // Then we don't want to watch it
      //       // TODO - Ideally these wouldn't be included in the GLOB of packages
      //       // Wasn't working so added this
      //       const subModules = path.split("@factor").pop()
      //       if ((event == "add" || event == "unlink") && (!subModules || !subModules.includes("node_modules"))) {
      //         this.generateLoaders()
      //         return true // update server
      //       } else {
      //         return false // server ignore
      //       }
      //     }
      //   })
      //   return _
      // })
    }

    generateLoaders() {
      const s = Date.now()

      const extensions = this.getExtensions()

      this.makeLoaderFile({
        extensions,
        destination: Factor.$paths.get("plugins-loader-build"),
        target: ["build", "app", "endpoint", "cloud"]
      })

      this.makeLoaderFile({
        extensions,
        destination: Factor.$paths.get("plugins-loader-app"),
        target: ["app"]
      })

      this.makeLoaderFile({
        extensions,
        destination: Factor.$paths.get("plugins-loader-cloud"),
        target: ["endpoint", "cloud"],
        requireAtRuntime: true
      })

      return `Loaders built for ${extensions.length} Extensions`
    }

    // getExtensionPatterns() {
    //   let patterns = []

    //   Factor.$paths.getModulesFolders().map(_ => {
    //     patterns = patterns.concat([
    //       path.resolve(_, `@${this.namespace}/**/package.json`),
    //       path.resolve(_, `${this.namespace}*/package.json`)
    //     ])
    //   })

    //   // Add package.json from CWD - Application directory
    //   patterns.push(Factor.$paths.get("app-package"))

    //   return patterns
    // }

    recursiveFactorDependencies(deps, pkg) {
      const { name, dependencies = {}, devDependencies = {} } = pkg

      const d = { ...dependencies, ...devDependencies }

      Object.keys(d)
        .filter(_ => _.includes("factor"))
        .map(_ => `${_}/package.json`)
        .forEach(_ => {
          if (!deps.includes(_)) {
            deps.push(_)
            deps = this.recursiveFactorDependencies(deps, require(_))
          }
        })

      return deps
    }

    getExtensions() {
      // const glob = require("glob").sync

      // let packagePaths = []
      // this.getExtensionPatterns().forEach(pattern => {
      //   packagePaths = packagePaths.concat(glob(pattern))
      // })
      const appPkg = Factor.$paths.get("app-package")
      const pkg = require(appPkg)
      const deps = this.recursiveFactorDependencies([appPkg], pkg)

      const list = this.getExtensionList(deps)

      const apps = list.map(_ => {
        return {
          name: _.name,
          scope: _.scope,
          target: _.target
        }
      })
      console.log("DEPS", deps)

      return list
    }

    getExtensionList(packagePaths) {
      const loader = []
      packagePaths.forEach(_ => {
        let fields = {}
        if (_.includes("package.json")) {
          let {
            name,
            factor: { id, priority = 100, target = false, service = "", provider = "", scope = "extension" } = {},
            version
          } = require(_)

          fields = {
            version,
            name,
            priority,
            target,
            service,
            provider,
            scope,
            cwd: _ == Factor.$paths.get("app-package") ? true : false,
            id: id || this.makeId(name.split(/endpoint-|plugin-|theme-|service-|@factor|@fiction/gi).pop())
          }
        } else {
          const basename = path.basename(_)
          const folderName = path.basename(path.dirname(_))

          // Aliases needed so paths can be changed if needed
          // Since webpack won't allow dynamic paths in require (variables in paths)

          fields = {
            name: Factor.$paths.replaceWithAliases(_),
            target: "app",
            id: basename == "plugin.js" ? folderName : this.makeId(basename)
          }
        }

        loader.push(fields)
      })

      return this.sortPriority(loader)
    }

    // Webpack doesn't allow dynamic paths in require statements
    // In order to make dynamic require statements, we build loader files
    // Also an easier way to see what is included than by using other techniques
    makeLoaderFile({ extensions, destination, target, requireAtRuntime = false }) {
      const fs = require("fs-extra")

      const filtered = this.filterExtensions({ target, extensions })

      const lines = [`/******** GENERATED FILE ********/`]

      lines.push("const files = {}")

      filtered.forEach(extension => {
        const { name, id, mainFile } = extension

        const moduleName = mainFile ? mainFile : name

        const r = requireAtRuntime ? JSON.stringify(extension) : `require("${moduleName}").default`
        lines.push(`files["${id}"] = ${r}`)
      })

      lines.push(`module.exports = files`)

      fs.ensureDirSync(path.dirname(destination))

      fs.writeFileSync(destination, lines.join("\n"))
    }

    filterExtensions({ target, extensions }) {
      const filtered = extensions.filter(_ => {
        if (_.scope !== "extension" && !_.cwd) {
          return false
        }
        return this.arrayIntersect(target, _.target)
      })

      return Factor.$filters.apply(`packages-loader`, filtered, { target, extensions })
    }

    arrayIntersect(targetA, targetB) {
      if (!targetA || !targetB) {
        return false
      } else if (targetA == "string" && targetB == "string" && targetA == targetB) {
        return true
      } else if (typeof targetA == "string" && Array.isArray(targetB) && targetB.includes(targetA)) {
        return true
      } else if (typeof targetB == "string" && Array.isArray(targetA) && targetA.includes(targetB)) {
        return true
      } else if (targetA.filter(value => targetB.includes(value)).length > 0) {
        return true
      } else {
        return false
      }
    }

    readHtmlFile(filePath, { minify = true, name = "" } = {}) {
      const fs = require("fs-extra")

      let str = fs.readFileSync(filePath, "utf-8")

      if (minify) {
        str = require("html-minifier").minify(str, {
          minifyJS: true,
          collapseWhitespace: true
        })
      }

      if (name) {
        str = `<!-- ${name} -->${str}<!-- / ${name} -->`
      }

      return str
    }

    makeId(name) {
      return name.replace(/\//gi, "").replace(/-([a-z])/g, function(g) {
        return g[1].toUpperCase()
      })
    }

    sortPriority(arr) {
      if (!arr || arr.length == 0) return arr

      return arr.sort((a, b) => {
        const ap = a.priority || a.name || 100
        const bp = b.priority || b.name || 100

        return ap < bp ? -1 : ap > bp ? 1 : 0
      })
    }
  })()
}
