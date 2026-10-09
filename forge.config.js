const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
	packagerConfig: {
		asar: {
			unpack: "*.{node,dll}",
		},
		/*
		icon: [
			'/build/icons/tmps.icns',
			'/build/icons/tmps.icon'
		],
		*/
		icon: './build/icons/tmps',
		osxSign: false, // Disables the blocking macOS keychain lookup
		// macOS 15+ blocks LAN traffic (console discovery + control) unless the app declares this
		extendInfo: {
			NSLocalNetworkUsageDescription: 'Presonus TheatreMix needs local network access to find and control your StudioLive console.',

			// Register .tmixp as this app's document type, shown with the app icon.
			// The packager copies the icon above into Resources as electron.icns.
			UTExportedTypeDeclarations: [
				{
					UTTypeIdentifier: 'com.maxmiller.presonus-theatremix.tmixp',
					UTTypeDescription: 'Presonus TheatreMix Show',
					UTTypeConformsTo: ['public.data'],
					UTTypeIconFile: 'electron.icns',
					UTTypeTagSpecification: {
						'public.filename-extension': ['tmixp'],
					},
				},
			],
			CFBundleDocumentTypes: [
				{
					CFBundleTypeName: 'Presonus TheatreMix Show',
					CFBundleTypeRole: 'Editor',
					CFBundleTypeIconFile: 'electron.icns',
					LSHandlerRank: 'Owner',
					LSItemContentTypes: ['com.maxmiller.presonus-theatremix.tmixp'],
				},
			],
		},
		ignore: [/node_modules\/(?!(better-sqlite3|bindings|file-uri-to-path)\/)/],
		ignore: [
		/^\/src/,        // Ignores your raw frontend source code
		/^\/.git/,       // Ignores git history
		/^\/angular/,    // Ignores raw angular/react workspaces if applicable
		/^\/\.vscode/,   // Ignores editor configuration files
		/^\/\.node_modules/,   // Ignores editor configuration files
		/^\/\.patches/,   // Ignores editor configuration files
		/^\/\.presonous/,   // Ignores editor configuration files
		/node_modules\/(?!(better-sqlite3|bindings|file-uri-to-path)\/)/,   // Ignores raw module files
		],
	},
	rebuildConfig: {},
	makers: [
		{
			name: '@electron-forge/maker-squirrel',
			config:  {
				authors: 'Max Miller',
				platforms: ['win32'],
				description: 'An Electron app to allow TheatreMix to work on Presonus StudioLive consoles'
			},
		},
		/*
		{
		name: '@electron-forge/maker-zip',
		platforms: ['darwin'],
		},
		{
		name: '@electron-forge/maker-deb',
		config: {},
		},
		{
		name: '@electron-forge/maker-rpm',
		config: {},
		},
		*/
		{
			name: '@electron-forge/maker-dmg',
			platforms: ['darwin'],
			config: {
				icon: './build/icons/tmps.icns',
				format: 'ULFO'
			}
		}
	],
	plugins: [
		{
		name: '@electron-forge/plugin-vite',
		config: {
			// `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
			// If you are familiar with Vite configuration, it will look really familiar.
			build: [
			{
				// `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
				entry: 'src/main.js',
				config: 'vite.main.config.mjs',
				target: 'main',
			},
			{
				entry: 'src/preload.js',
				config: 'vite.preload.config.mjs',
				target: 'preload',
			},
			],
			renderer: [
			{
				name: 'main_window',
				config: 'vite.renderer.config.mjs',
			},
			],
		},
		},
		// Fuses are used to enable/disable various Electron functionality
		// at package time, before code signing the application
		new FusesPlugin({
		version: FuseVersion.V1,
		[FuseV1Options.RunAsNode]: false,
		[FuseV1Options.EnableCookieEncryption]: true,
		[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
		[FuseV1Options.EnableNodeCliInspectArguments]: false,
		[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
		[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],

};
