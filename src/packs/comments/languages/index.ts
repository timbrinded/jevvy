import type { Language } from '../../../contracts.ts';

export interface LanguageRules {
  comments: Set<string>;
  callables: Set<string>;
  declarations: Set<string>;
  wrappers: Set<string>;
}
const set = (...values: string[]) => new Set(values);
const js = {
  comments: set('comment'),
  callables: set(
    'function_declaration',
    'function_expression',
    'generator_function_declaration',
    'generator_function',
    'arrow_function',
    'method_definition',
    'function_signature',
    'method_signature',
  ),
  declarations: set(
    'class_declaration',
    'abstract_class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'public_field_definition',
    'property_signature',
    'lexical_declaration',
    'variable_declaration',
  ),
  wrappers: set('export_statement', 'decorator'),
};
export const rules: Record<Language, LanguageRules> = {
  typescript: js,
  tsx: js,
  javascript: js,
  jsx: js,
  rust: {
    comments: set('line_comment', 'block_comment'),
    callables: set('function_item', 'function_signature_item'),
    declarations: set(
      'struct_item',
      'enum_item',
      'trait_item',
      'impl_item',
      'mod_item',
      'field_declaration',
      'const_item',
      'static_item',
      'type_item',
    ),
    wrappers: set('attribute_item', 'inner_attribute_item'),
  },
  python: {
    comments: set('comment'),
    callables: set('function_definition'),
    declarations: set('class_definition'),
    wrappers: set('decorated_definition'),
  },
  solidity: {
    comments: set('comment'),
    callables: set(
      'function_definition',
      'constructor_definition',
      'modifier_definition',
      'fallback_receive_definition',
    ),
    declarations: set(
      'contract_declaration',
      'interface_declaration',
      'library_declaration',
      'struct_declaration',
      'enum_declaration',
      'event_definition',
      'error_declaration',
      'state_variable_declaration',
    ),
    wrappers: set(),
  },
};
