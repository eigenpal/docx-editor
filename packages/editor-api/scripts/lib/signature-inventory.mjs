import ts from 'typescript';

// Tokenize instead of deleting whitespace: string values and nested unions must survive.
function normalizedTokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    tokens.push(
      token === ts.SyntaxKind.StringLiteral
        ? JSON.stringify(scanner.getTokenValue())
        : scanner.getTokenText()
    );
  }
  return tokens
    .filter(
      (token, index) =>
        !((token === 'Word' || token === 'OfficeExtension') && tokens[index + 1] === '.') &&
        !(token === '.' && ['Word', 'OfficeExtension'].includes(tokens[index - 1]))
    )
    .join(' ');
}

export function normalizeSignatureText(text) {
  const source = ts.createSourceFile(
    'shape.ts',
    `type Shape = ${text};`,
    ts.ScriptTarget.Latest,
    true
  );
  if (source.parseDiagnostics.length) throw new Error(`Cannot normalize type: ${text}`);
  const printer = ts.createPrinter({ removeComments: true });
  const transformed = ts.transform(source.statements[0].type, [
    (context) => {
      const visit = (node) => {
        const child = ts.visitEachChild(node, visit, context);
        if (!ts.isUnionTypeNode(child)) return child;
        const members = [...child.types].sort((a, b) =>
          normalizedTokens(printer.printNode(ts.EmitHint.Unspecified, a, source)).localeCompare(
            normalizedTokens(printer.printNode(ts.EmitHint.Unspecified, b, source)),
            'en'
          )
        );
        return ts.factory.updateUnionTypeNode(child, members);
      };
      return visit;
    },
  ]);
  try {
    return normalizedTokens(
      printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], source)
    );
  } finally {
    transformed.dispose();
  }
}

function publicSymbol(symbol) {
  return (
    !symbol.name.startsWith('#') &&
    !(symbol.declarations ?? []).some(
      (node) =>
        ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
    )
  );
}

function memberName(symbol) {
  const name = symbol.declarations?.[0]?.name;
  return name && ts.isComputedPropertyName(name) ? name.getText() : symbol.name;
}

function typeText(checker, type) {
  return normalizeSignatureText(
    checker.typeToString(
      type,
      undefined,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
    )
  );
}

function typeParameters(checker, parameters = []) {
  return parameters.map((type) => ({
    name: type.symbol.name,
    constraint: type.getConstraint() ? typeText(checker, type.getConstraint()) : null,
    default: type.getDefault() ? typeText(checker, type.getDefault()) : null,
  }));
}

function signatures(checker, type, kind) {
  return checker.getSignaturesOfType(type, kind).map((signature) => {
    const predicate = checker.getTypePredicateOfSignature(signature);
    return {
      ...(signature.thisParameter
        ? {
            thisType: typeText(
              checker,
              checker.getTypeOfSymbolAtLocation(signature.thisParameter, signature.declaration)
            ),
          }
        : {}),
      ...(predicate
        ? {
            predicate: {
              kind: predicate.kind,
              parameterIndex: predicate.parameterIndex ?? null,
              type: predicate.type ? typeText(checker, predicate.type) : null,
            },
          }
        : {}),
      typeParameters: typeParameters(checker, signature.typeParameters),
      parameters: signature.parameters.map((parameter) => {
        const node = parameter.valueDeclaration ?? parameter.declarations?.[0];
        return {
          type: typeText(checker, checker.getTypeOfSymbolAtLocation(parameter, node), node),
          optional: Boolean(node?.questionToken || node?.initializer),
          rest: Boolean(node?.dotDotDotToken),
        };
      }),
      returns: typeText(
        checker,
        checker.getReturnTypeOfSignature(signature),
        signature.declaration
      ),
    };
  });
}

function requirementSet(symbol) {
  const text = (symbol.declarations ?? [])
    .map((node) => node.getFullText().slice(0, node.getStart() - node.getFullStart()))
    .join('\n');
  return /\[Api set:\s*([^\]]+)\]/.exec(text)?.[1]?.trim() ?? null;
}

function setterType(checker, setter, ownerType) {
  const parameter = setter.parameters[0];
  const declaringType = checker.getTypeAtLocation(setter.parent);
  const visited = new Set();
  function find(type) {
    if (!type || visited.has(type)) return undefined;
    visited.add(type);
    if (type.symbol === declaringType.symbol) return type;
    return type.isClassOrInterface?.() || type.objectFlags & ts.ObjectFlags.Reference
      ? (checker.getBaseTypes(type) ?? []).map(find).find(Boolean)
      : undefined;
  }
  const base = find(ownerType);
  const parameters = base?.target?.typeParameters ?? [];
  if (!parameters.length || !parameter.type)
    return typeText(checker, checker.getTypeAtLocation(parameter));
  const arguments_ = checker.getTypeArguments(base);
  const replacements = new Map(parameters.map((type, index) => [type.symbol, arguments_[index]]));
  const transformed = ts.transform(parameter.type, [
    (context) => {
      const visit = (node) => {
        if (ts.isTypeReferenceNode(node)) {
          const replacement = replacements.get(checker.getSymbolAtLocation(node.typeName));
          if (replacement)
            return checker.typeToTypeNode(replacement, undefined, ts.NodeBuilderFlags.NoTruncation);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return visit;
    },
  ]);
  try {
    return normalizeSignatureText(
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, transformed.transformed[0], setter.getSourceFile())
    );
  } finally {
    transformed.dispose();
  }
}

function memberShape(checker, symbol, ownerType) {
  const node = symbol.valueDeclaration ?? symbol.declarations?.[0];
  const type = checker.getTypeOfSymbolAtLocation(symbol, node);
  const calls = signatures(checker, type, ts.SignatureKind.Call);
  const optional = Boolean(symbol.flags & ts.SymbolFlags.Optional);
  if (symbol.flags & ts.SymbolFlags.Method) return { kind: 'method', optional, overloads: calls };
  const declarations = symbol.declarations ?? [];
  const readonly =
    (ts.isVariableDeclaration(node) &&
      Boolean(ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const)) ||
    declarations.some((d) => ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly) ||
    (declarations.some(ts.isGetAccessorDeclaration) &&
      !declarations.some(ts.isSetAccessorDeclaration));
  const setter = declarations.find(ts.isSetAccessorDeclaration);
  const writeType = readonly
    ? null
    : setter?.parameters[0]
      ? setterType(checker, setter, ownerType)
      : typeText(checker, type, node);
  const readable = !setter || declarations.some(ts.isGetAccessorDeclaration);
  return {
    kind: 'property',
    optional,
    readonly,
    readable,
    type: typeText(checker, type, node),
    writeType,
  };
}

/** Extract public members through the compiler, including inheritance, overloads and re-exports. */
export function inventoryModule(checker, moduleSymbol, prefix, { recurse = true } = {}) {
  const rows = [];
  function visit(module, namespace) {
    for (let symbol of checker.getExportsOfModule(module)) {
      const name = symbol.name;
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      if (!publicSymbol(symbol)) continue;
      const uid = `${namespace}.${name}`;
      const scope = namespace === prefix ? 'api' : 'supporting-types';
      const ownerParameters =
        symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)
          ? typeParameters(checker, checker.getDeclaredTypeOfSymbol(symbol).typeParameters)
          : symbol.flags & ts.SymbolFlags.TypeAlias
            ? typeParameters(
                checker,
                (symbol.declarations.find(ts.isTypeAliasDeclaration).typeParameters ?? []).map(
                  (node) => checker.getTypeAtLocation(node)
                )
              )
            : [];
      const add = (id, shape, source = symbol) =>
        rows.push({
          uid: id,
          scope,
          requirementSet: requirementSet(source),
          ...(ownerParameters.length ? { ownerTypeParameters: ownerParameters } : {}),
          ...shape,
        });
      if (symbol.flags & ts.SymbolFlags.Module) {
        if (recurse) visit(symbol, uid);
        if (
          !(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Function | ts.SymbolFlags.Enum))
        )
          continue;
      }
      if (symbol.flags & ts.SymbolFlags.Function) {
        add(uid, {
          kind: 'function',
          overloads: signatures(
            checker,
            checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration),
            ts.SignatureKind.Call
          ),
        });
        continue;
      }
      if (
        symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface) ||
        (symbol.flags & ts.SymbolFlags.TypeAlias &&
          checker.getDeclaredTypeOfSymbol(symbol).flags & ts.TypeFlags.Object)
      ) {
        const type = checker.getDeclaredTypeOfSymbol(symbol);
        const members = checker.getPropertiesOfType(type).filter(publicSymbol);
        for (const member of members)
          add(`${uid}#${memberName(member)}`, memberShape(checker, member, type), member);
        for (const index of checker.getIndexInfosOfType(type)) {
          add(`${uid}#index:${typeText(checker, index.keyType)}`, {
            kind: 'index',
            readonly: index.isReadonly,
            type: typeText(checker, index.type),
          });
        }
        for (const [kind, label] of [
          [ts.SignatureKind.Call, 'call'],
          [ts.SignatureKind.Construct, 'new'],
        ]) {
          const overloads = signatures(checker, type, kind);
          if (overloads.length) add(`${uid}#${label}`, { kind: label, overloads });
        }
        if (members.length === 0) add(uid, { kind: 'type', type: typeText(checker, type) });
        if (symbol.flags & ts.SymbolFlags.Class) {
          const staticType = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
          for (const member of checker.getPropertiesOfType(staticType).filter(publicSymbol)) {
            if (member.name !== 'prototype')
              add(`${uid}.${memberName(member)}`, memberShape(checker, member), member);
          }
          const constructors = signatures(checker, staticType, ts.SignatureKind.Construct).filter(
            (_, i) => {
              const declaration = checker.getSignaturesOfType(
                staticType,
                ts.SignatureKind.Construct
              )[i].declaration;
              return (
                !declaration ||
                !(
                  ts.getCombinedModifierFlags(declaration) &
                  (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
                )
              );
            }
          );
          if (constructors.length)
            add(`${uid}#constructor`, { kind: 'constructor', overloads: constructors });
        }
        continue;
      }
      if (symbol.flags & ts.SymbolFlags.Enum) {
        for (const member of checker.getExportsOfModule(symbol)) {
          const value = checker.getConstantValue(member.valueDeclaration);
          add(`${uid}.${member.name}`, { kind: 'enum-member', value: value ?? null }, member);
        }
        continue;
      }
      if (symbol.flags & ts.SymbolFlags.TypeAlias) {
        add(uid, {
          kind: 'type',
          type: typeText(checker, checker.getDeclaredTypeOfSymbol(symbol)),
        });
        continue;
      }
      add(uid, memberShape(checker, symbol));
    }
  }
  visit(moduleSymbol, prefix);
  return rows.sort((a, b) => a.uid.localeCompare(b.uid, 'en'));
}

export function extractUpstreamInventory(sourceText) {
  const filename = '/office-compat-reference.d.ts';
  const options = { strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (name, ...args) =>
    name === filename
      ? ts.createSourceFile(filename, sourceText, options.target, true)
      : original(name, ...args);
  const program = ts.createProgram([filename], options, host);
  if (program.getSyntacticDiagnostics().length)
    throw new Error('Invalid upstream declaration syntax');
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(filename);
  const rows = [];
  for (const name of ['Word', 'OfficeExtension']) {
    const declaration = source.statements.find(
      (node) => ts.isModuleDeclaration(node) && node.name.text === name
    );
    if (!declaration) throw new Error(`Missing upstream namespace ${name}`);
    rows.push(...inventoryModule(checker, checker.getSymbolAtLocation(declaration.name), name));
  }
  return rows;
}
