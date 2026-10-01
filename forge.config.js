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
	extraResource: [
		// TODO: Remove
		'./HaydenTest.tmix',    // Test File
		'./LionKingKidsV2.db',  // Copy an external executable
		],
	},
	rebuildConfig: {},
	makers: [
		/*
		{
		name: '@electron-forge/maker-squirrel',
		config: {},
		},
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
				format: 'ULFO',
				icon: './build/icons/tmps.icns'
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
