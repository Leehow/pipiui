/**
 * tree-sitter queries for function / class / method / import / call.
 * Shape follows Aider repomap + official language `queries/tags.scm`,
 * without `#strip!` / `#select-adjacent!` predicates (not required, can fail).
 */

import type { SupportedLang } from "./types.js";

const PYTHON = `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(call
  function: [
    (identifier) @name.reference.call
    (attribute
      attribute: (identifier) @name.reference.call)
  ]) @reference.call

(import_statement
  name: (dotted_name) @name.definition.import) @definition.import

(import_statement
  name: (aliased_import
    name: (dotted_name) @name.definition.import)) @definition.import

(import_from_statement
  module_name: (dotted_name) @import.module) @definition.import

(import_from_statement
  module_name: (relative_import) @import.module) @definition.import
`;

const JAVASCRIPT = `
(class_declaration
  name: (_) @name.definition.class) @definition.class

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(generator_function_declaration
  name: (identifier) @name.definition.function) @definition.function

(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call)) @reference.call

(import_statement
  source: (string) @name.definition.import) @definition.import
`;

const TYPESCRIPT = `
${JAVASCRIPT}

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(type_alias_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(function_signature
  name: (identifier) @name.definition.function) @definition.function

(method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_method_signature
  name: (property_identifier) @name.definition.method) @definition.method
`;

const RUST = `
(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(enum_item
  name: (type_identifier) @name.definition.class) @definition.class

(union_item
  name: (type_identifier) @name.definition.class) @definition.class

(type_item
  name: (type_identifier) @name.definition.class) @definition.class

(trait_item
  name: (type_identifier) @name.definition.interface) @definition.interface

(mod_item
  name: (identifier) @name.definition.module) @definition.module

(function_item
  name: (identifier) @name.definition.function) @definition.function

(impl_item
  type: (type_identifier) @impl.type) @definition.class

(call_expression
  function: (identifier) @name.reference.call) @reference.call

(call_expression
  function: (field_expression
    field: (field_identifier) @name.reference.call)) @reference.call

(macro_invocation
  macro: (identifier) @name.reference.call) @reference.call

(use_declaration) @definition.import
`;

const BY_LANG: Record<SupportedLang, string> = {
  python: PYTHON,
  javascript: JAVASCRIPT,
  typescript: TYPESCRIPT,
  tsx: TYPESCRIPT,
  rust: RUST,
};

export function querySourceFor(lang: SupportedLang): string {
  return BY_LANG[lang];
}

/**
 * Extra call-site patterns compiled independently of the main tag query.
 * A compile failure here must not take down function/class extraction.
 */
export function extraCallQuerySourceFor(lang: SupportedLang): string | null {
  if (lang === "rust") {
    return `
(call_expression
  function: (scoped_identifier
    name: (identifier) @name.reference.call)) @reference.call
`;
  }
  return null;
}
