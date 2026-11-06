#!/usr/bin/env node
// Recover a machine-readable API description from the backend's generated Go.
//
// The backend commits `cmd/server/docs/docs.go` and nothing else — no
// `swagger.json`, no `openapi.yaml`, no AsyncAPI. That file is not opaque
// though: swag embeds the whole description as a Go raw-string literal named
// `docTemplate`, with six `text/template` placeholders in the `info` header and
// literal JSON everywhere else. Substituting those six placeholders yields a
// valid document.
//
// This exists to measure the cost of the missing artifact, not to become the
// supported way to get one. The supported fix is one flag on the backend's
// `swag` task (see ../README.md).

import { readFileSync } from "node:fs"

const RAW_OPEN = "const docTemplate = `"

// Go raw-string literals cannot contain a backtick, so swag splits the literal
// and concatenates an interpreted `"`"` between the halves. At least one route
// description uses backticks for markdown, so this is not a hypothetical case.
const BACKTICK_JOIN = '` + "`" + `'

/**
 * Pull the `docTemplate` raw-string literal out of swag's generated Go,
 * rejoining any backtick-escaped segments.
 */
export function extractTemplate(source) {
	const open = source.indexOf(RAW_OPEN)
	if (open === -1) {
		throw new Error(
			"no `docTemplate` raw-string literal found — this does not look like swag-generated Go",
		)
	}

	const parts = []
	let pos = open + RAW_OPEN.length

	for (;;) {
		const tick = source.indexOf("`", pos)
		if (tick === -1) {
			throw new Error("unterminated `docTemplate` raw-string literal")
		}
		if (source.startsWith(BACKTICK_JOIN, tick)) {
			parts.push(source.slice(pos, tick), "`")
			pos = tick + BACKTICK_JOIN.length
			continue
		}
		parts.push(source.slice(pos, tick))
		return parts.join("")
	}
}

/**
 * Substitute the six `text/template` actions swag leaves in the `info` header.
 *
 * These are the only non-literal parts of the document; `paths` and
 * `definitions` are plain JSON. Values are deployment metadata the caller
 * chooses, which is exactly why swag left them as placeholders.
 */
export function fillPlaceholders(template, meta = {}) {
	const {
		schemes = ["https"],
		description = "",
		title = "Haiven API",
		version = "0.0.0",
		host = "localhost",
		basePath = "/v0",
	} = meta

	const substitutions = new Map([
		["{{ marshal .Schemes }}", JSON.stringify(schemes)],
		["{{escape .Description}}", JSON.stringify(description).slice(1, -1)],
		["{{.Title}}", title],
		["{{.Version}}", version],
		["{{.Host}}", host],
		["{{.BasePath}}", basePath],
	])

	let out = template
	for (const [action, value] of substitutions) {
		out = out.replaceAll(action, value)
	}

	const leftover = out.match(/\{\{[^}]*\}\}/)
	if (leftover) {
		throw new Error(`unsubstituted template action: ${leftover[0]}`)
	}
	return out
}

/** Read swag-generated Go and return the parsed API description. */
export function extractFromSource(source, meta) {
	return JSON.parse(fillPlaceholders(extractTemplate(source), meta))
}

/** Read swag-generated Go from disk and return the parsed API description. */
export function extractFromFile(path, meta) {
	return extractFromSource(readFileSync(path, "utf8"), meta)
}

/**
 * Summarise the recovered document along the axes the spike cares about:
 * how much surface there is, and which schema definitions are sealed enums.
 */
export function summarize(doc) {
	const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"])

	let operations = 0
	const successBodies = { typed: [], bareString: [], noSchema: [] }

	for (const [route, item] of Object.entries(doc.paths ?? {})) {
		for (const [method, operation] of Object.entries(item)) {
			if (!METHODS.has(method)) continue
			operations += 1

			const responses = operation.responses ?? {}
			const success = responses["200"] ?? responses["201"] ?? responses["204"]
			if (!success) continue

			const label = `${method.toUpperCase()} ${route}`
			if (!success.schema) successBodies.noSchema.push(label)
			else if (success.schema.type === "string") successBodies.bareString.push(label)
			else successBodies.typed.push(label)
		}
	}

	// A vocabulary is sealed or open depending on the keyword carrying it, and
	// that distinction is the whole of finding F2 — an `enum` generates a type
	// that cannot hold a value minted after the client shipped, while
	// `x-extensible-enum` generates one that can. Count them apart.
	const byKeyword = (keyword) =>
		Object.entries(doc.definitions ?? {})
			.filter(([, schema]) => Array.isArray(schema?.[keyword]))
			.map(([name, schema]) => ({ name, values: schema[keyword], size: schema[keyword].length }))
			.sort((a, b) => b.size - a.size)

	return {
		spec: doc.swagger ? `swagger ${doc.swagger}` : `openapi ${doc.openapi ?? "unknown"}`,
		paths: Object.keys(doc.paths ?? {}).length,
		operations,
		definitions: Object.keys(doc.definitions ?? {}).length,
		sealedEnums: byKeyword("enum"),
		openEnums: byKeyword("x-extensible-enum"),
		successBodies,
	}
}

// Relative to this file: scripts -> this repo -> the parent that holds the
// sibling `haiven-api` checkout.
export const DEFAULT_SOURCE = "../../haiven-api/cmd/server/docs/docs.go"

if (import.meta.filename === process.argv[1]) {
	const [, , sourceArg, outArg] = process.argv
	const source = sourceArg ?? new URL(DEFAULT_SOURCE, import.meta.url).pathname

	let doc
	try {
		doc = extractFromFile(source)
	} catch (err) {
		if (err.code === "ENOENT") {
			console.error(`no swag-generated Go at ${source}`)
			console.error("pass a path explicitly, or check out ../haiven-api beside this repo")
			process.exit(2)
		}
		throw err
	}

	if (outArg) {
		const { writeFileSync } = await import("node:fs")
		writeFileSync(outArg, `${JSON.stringify(doc, null, 2)}\n`)
		console.error(`wrote ${outArg}`)
	}

	const s = summarize(doc)
	console.error(`spec:        ${s.spec}`)
	console.error(`paths:       ${s.paths}`)
	console.error(`operations:  ${s.operations}`)
	console.error(`definitions: ${s.definitions}`)
	console.error(
		`success bodies: ${s.successBodies.typed.length} typed, ` +
			`${s.successBodies.bareString.length} bare string, ` +
			`${s.successBodies.noSchema.length} no schema`,
	)
	for (const e of s.sealedEnums) {
		console.error(`sealed enum: ${e.name} (${e.size} values)`)
	}
	for (const e of s.openEnums) {
		console.error(`open vocabulary: ${e.name} (${e.size} registered values)`)
	}
}
