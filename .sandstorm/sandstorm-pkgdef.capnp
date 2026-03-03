@0xc2cc78cf1ed06645;

using Spk = import "/sandstorm/package.capnp";

const pkgdef :Spk.PackageDefinition = (
  id = "7ed7t86vj4xy5rsw5a21p69cvptmwvv4xqh6y06ajs0ay52t1rv0",

  manifest = (
    appTitle = (defaultText = "File Previewer"),

    appVersion = 2,
    appMarketingVersion = (defaultText = "0.2.0"),

    actions = [
      ( title = (defaultText = "New Previewer"),
        command = .myCommand
      )
    ],

    continueCommand = .myCommand,

    metadata = (
      website = "https://github.com/mnutt/file-previewer",
      codeUrl = "https://github.com/mnutt/file-previewer",
      license = (none = void),
      categories = [productivity],

      author = (
        contactEmail = "michael@nutt.im"
      ),

      description = (defaultText = embed "description.md"),
      shortDescription = (defaultText = "Doc preview"),
    ),
  ),

  sourceMap = (
    searchPath = [
      ( sourcePath = "." ),
      ( packagePath = "proc/version",
        sourcePath = "/opt/app/.sandstorm/fake/proc-version" ),
      ( packagePath = "proc/mounts",
        sourcePath = "/opt/app/.sandstorm/fake/proc-mounts" ),
      ( packagePath = "proc/filesystems",
        sourcePath = "/opt/app/.sandstorm/fake/proc-filesystems" ),
      ( packagePath = "proc/meminfo",
        sourcePath = "/opt/app/.sandstorm/fake/proc-meminfo" ),
      ( packagePath = "etc/passwd",
        sourcePath = "/opt/app/.sandstorm/fake/etc-passwd" ),
      ( sourcePath = "/",
        hidePaths = [ "home", "proc", "sys", "run",
                      "etc/passwd", "etc/hosts", "etc/host.conf",
                      "etc/nsswitch.conf", "etc/resolv.conf" ]
      )
    ]
  ),

  fileList = "sandstorm-files.list",

  alwaysInclude = [
    "proc",
    "proc/version",
    "proc/mounts",
    "proc/filesystems",
    "proc/meminfo",
    "opt/app/.sandstorm",
    "opt/app/public",
    "opt/app/app.js",
    "opt/app/package.json",
    "usr/local/bin/unoconvert",
    "usr/local/bin/unoserver",
    "usr/local/bin/unoping",
    "usr/bin/soffice",
    "usr/lib/libreoffice",
    "usr/share/libreoffice",
    "usr/lib/python3",
    "usr/lib/python3.11",
    "usr/local/lib/python3.11",
  ],

  bridgeConfig = (
    viewInfo = (
      permissions = [(name = "view")],
      roles = [(title = (defaultText = "viewer"),
                permissions = [true],
                verbPhrase = (defaultText = "can preview files"),
                default = true)],
    ),
    powerboxApis = [
      (
        name = "officeToPdf",
        displayInfo = (
          title = (defaultText = "Convert Office files to PDF")
        ),
        path = "/api",
        tag = (canonicalUrl = "org.sandstorm.powerbox.office-to-pdf/v1"),
        permissions = [true]
      )
    ],
    saveIdentityCaps = true
  )
);

const myCommand :Spk.Manifest.Command = (
  argv = ["/sandstorm-http-bridge", "8000", "--", "/opt/app/.sandstorm/launcher.sh"],
  environ = [
    (key = "PATH", value = "/opt/app/vendor:/usr/local/bin:/usr/bin:/bin"),
    (key = "PORT", value = "8000"),
    (key = "HOME", value = "/var"),
    (key = "SANDSTORM", value = "1"),
    (key = "TMPDIR", value = "/tmp"),
    (key = "UserInstallation", value = "file:///tmp/libreoffice-config"),
    (key = "JAVA_HOME", value = ""),
    (key = "LO_JAVA_ENABLED", value = "false"),
  ]
);
