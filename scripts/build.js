'use strict';

const path = require('path');
const utility = require('./utility');
const ts = require('typescript');
const externals = require('./rollup-externals');
const esbuild_externals = require('./esbuild-externals');
const winston = require('winston');
const logger = winston.createLogger({
	level: process.env.LOG_LEVEL ? process.env.LOG_LEVEL.toLowerCase() : 'info',
	transports: [
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.prettyPrint(2),
				winston.format.colorize({ all: true })
			),
		}),
	],
});

const cdn = 'https://cdn.amplify.aws/';
const localhost = 'http://localhost:8080/';

// path of root
const rootPath = path.resolve(__dirname, '../');
// path of each package
const pkgRootPath = process.cwd();

const pkgTscES5OutDir = path.join(pkgRootPath, 'lib');
const pkgTscES6OutDir = path.join(pkgRootPath, 'lib-esm');
const pkgSrcDir = path.join(pkgRootPath, 'src');
const typeRoots = [rootPath, pkgRootPath].map(basePath =>
	path.join(basePath, 'node_modules/@types')
);
const packageJsonPath = path.join(pkgRootPath, 'package');
const packageInfo = require(packageJsonPath);
const pkgRollUpInputFile = path.join(pkgTscES5OutDir, 'index.js');
const pkgRollUpOutputFile = path.join(pkgRootPath, packageInfo.main);

const es5TsBuildInfoFilePath = path.join(pkgTscES5OutDir, '.tsbuildinfo');
const es6TsBuildInfoFilePath = path.join(pkgTscES6OutDir, '.tsbuildinfo');

async function buildRollUp() {
	logger.info(`Building Roll up bundle file under ${pkgRootPath}`);
	const rollup = require('rollup');
	const resolve = require('rollup-plugin-node-resolve');
	const sourceMaps = require('rollup-plugin-sourcemaps');
	const json = require('rollup-plugin-json');

	// For more info see: https://github.com/rollup/rollup/issues/1518#issuecomment-321875784
	const onwarn = warning => {
		if (warning.code === 'THIS_IS_UNDEFINED') {
			return;
		}
		console.warn(warning.message);
	};

	const inputOptions = {
		pkgRollUpInputFile,
		plugins: [json(), resolve({ extensions: ['.js', '.json'] }), sourceMaps()],
		external: externals[packageInfo.name],
		onwarn,
	};

	const outputOptions = {
		pkgRollUpOutputFile,
		format: 'cjs',
		name: 'index',
		sourcemap: true,
		exports: 'named',
	};

	logger.info(`Using the rollup configuration:`);
	logger.info(inputOptions);
	logger.info(outputOptions);

	try {
		const bundle = await rollup.rollup(inputOptions);
		await bundle.write(outputOptions);
	} catch (e) {
		logger.error(e);
	}
}

const formatHost = {
	getCanonicalFileName: path => path,
	getCurrentDirectory: ts.sys.getCurrentDirectory,
	getNewLine: () => ts.sys.newLine,
};

function runTypeScriptWithoutWatchMode(fileNames, options) {
	let program = ts.createProgram(fileNames, options);
	let emitResult = program.emit();

	let allDiagnostics = ts
		.getPreEmitDiagnostics(program)
		.concat(emitResult.diagnostics);

	allDiagnostics.forEach(diagnostic => {
		reportErrorDiagnostic(diagnostic);
	});

	let exitCode = emitResult.emitSkipped ? 1 : 0;
	logger.info(`Process exiting with code '${exitCode}'.`);
	process.exit(exitCode);
}

function runTypeScriptWithWatchMode(fileNames, options) {
	// https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API#writing-an-incremental-program-watcher
	const createProgram = ts.createEmitAndSemanticDiagnosticsBuilderProgram;

	const host = ts.createWatchCompilerHost(
		fileNames,
		options,
		ts.sys,
		createProgram,
		reportErrorDiagnostic,
		reportWatchStatusChanged,
		null
	);

	// `createWatchProgram` creates an initial program, watches files, and updates
	// the program over time.
	ts.createWatchProgram(host);
}

function reportErrorDiagnostic(diagnostic) {
	if (diagnostic.file) {
		let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
			diagnostic.start
		);
		let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
		logger.error(
			`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`
		);
	} else {
		logger.error(
			`${ts.flattenDiagnosticMessageText(
				diagnostic.messageText,
				formatHost.getNewLine()
			)}`
		);
	}
}

/**
 * Prints a diagnostic every time the watch status changes.
 * This is mainly for messages like "Starting compilation" or "Compilation completed".
 */
function reportWatchStatusChanged(diagnostic, newLine, options, errorCount) {
	logger.info(ts.formatDiagnostic(diagnostic, formatHost));
}

async function buildES5(typeScriptCompiler, watchMode) {
	const jsx = ['@aws-amplify/ui-react', 'aws-amplify-react'].includes(
		packageInfo.name
	)
		? 'react'
		: undefined;
	// tsconfig for ES5 generating
	let compilerOptions = {
		esModuleInterop: true,
		noImplicitAny: false,
		lib: [
			'dom',
			'es2017',
			'esnext.asynciterable',
			'es2018.asyncgenerator',
			'es2019',
		],
		downlevelIteration: true,
		jsx: jsx,
		target: 'es5',
		module: 'commonjs',
		moduleResolution: 'node',
		declaration: true,
		noEmitOnError: true,
		incremental: true,
		tsBuildInfoFile: es5TsBuildInfoFilePath,
		typeRoots,
		// temporary fix
		types: ['node'],
		outDir: pkgTscES5OutDir,
	};

	if (watchMode) {
		compilerOptions.inlineSourceMap = true;
		compilerOptions.inlineSources = true;
	} else {
		compilerOptions.sourceMap = true;
	}

	compilerOptions = ts.convertCompilerOptionsFromJson(compilerOptions);
	const include = [pkgSrcDir];
	logger.debug(`Using the typescript compiler options:`);
	logger.debug(compilerOptions);

	let fileList = [];
	Promise.all(
		include.map(async source => {
			const list = await utility.iterateFiles(source);
			return (fileList = fileList.concat(list));
		})
	).then(() => {
		logger.debug('Files to be transpiled by tsc:');
		logger.debug(fileList);
		typeScriptCompiler(fileList, compilerOptions.options);
	});
}

function buildES6(typeScriptCompiler, watchMode) {
	const jsx = ['@aws-amplify/ui-react', 'aws-amplify-react'].includes(
		packageInfo.name
	)
		? 'react'
		: undefined;
	// tsconfig for ESM generating
	let compilerOptions = {
		esModuleInterop: true,
		noImplicitAny: false,
		lib: [
			'dom',
			'es2017',
			'esnext.asynciterable',
			'es2018.asyncgenerator',
			'es2019',
		],
		downlevelIteration: true,
		jsx: jsx,
		target: 'es5',
		module: 'es2015',
		moduleResolution: 'node',
		declaration: true,
		noEmitOnError: true,
		incremental: true,
		tsBuildInfoFile: es6TsBuildInfoFilePath,
		typeRoots,
		// temporary fix
		types: ['node'],
		outDir: pkgTscES6OutDir,
	};

	if (watchMode) {
		compilerOptions.inlineSourceMap = true;
		compilerOptions.inlineSources = true;
	} else {
		compilerOptions.sourceMap = true;
	}

	compilerOptions = ts.convertCompilerOptionsFromJson(compilerOptions);
	const include = [pkgSrcDir];
	logger.debug(`Using the typescript compiler options:`);
	logger.debug(compilerOptions);

	let fileList = [];
	Promise.all(
		include.map(async source => {
			const list = await utility.iterateFiles(source);
			return (fileList = fileList.concat(list));
		})
	).then(() => {
		logger.debug('Files to be transpiled by tsc:');
		logger.debug(fileList);
		typeScriptCompiler(fileList, compilerOptions.options);
	});
}

function esbuild(dev) {
	// const origin = dev ? localhost : cdn;
	logger.info(`esbuilding: ${packageInfo.name} ${packageInfo.version}`);
	const packageCategory = packageInfo.name.startsWith('@aws-amplify/') ? packageInfo.name.substring(13) : undefined;

	const external = esbuild_externals[packageInfo.name];

	const dependencies = external.map(packageName => {
		return {
			packageName,
			category: packageName.startsWith('@aws-amplify/') ? packageName.substring(13) : undefined,
			version: packageInfo.dependencies[packageName]
		}
	})

	if (packageCategory) {
		const esbuild = require('esbuild');

		esbuild.build({
			entryPoints: ['./src/index.ts'],
			bundle: true,
			outfile: `./dist/${packageCategory}-esm.js`,
			format: 'esm',
			minify: false,
			define: {
				global: 'window'
			},
			external,
			plugins: [
				{
					name: 'dependency',
					setup(build) {
						for (const dependency of dependencies) {
							const filter = new RegExp(dependency.packageName);
							build.onResolve({
								filter
							}, (args) => {
								return { path: `../../${dependency.category}/${dependency.version}/${dependency.category}-esm.js`, external: true }
							})
						}
					}
				}
			],
		})
			.catch(() => process.exit(1))

	}
}

function build(type, watchMode) {
	if (type === 'esbuild') esbuild();
	if (type === 'esbuild-dev') esbuild(true);
	if (type === 'rollup') buildRollUp();

	var typeScriptCompiler = watchMode
		? runTypeScriptWithWatchMode
		: runTypeScriptWithoutWatchMode;

	if (type === 'es5') buildES5(typeScriptCompiler, watchMode);
	if (type === 'es6') buildES6(typeScriptCompiler, watchMode);
}

module.exports = build;
