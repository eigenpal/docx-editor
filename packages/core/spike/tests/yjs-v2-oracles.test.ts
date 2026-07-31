import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Obj = Record<string, unknown>;
const dir = join(import.meta.dir, '..', 'oracles');
const names = ['yjs-schema.v2.json','binding-oracle.v2.json','history-oracle.v2.json','comparator-contracts.v2.json'] as const;
const obj = (value: unknown): Obj => value as Obj;
const arr = (value: unknown): unknown[] => value as unknown[];
const at = (value: unknown, ...path: string[]): unknown => path.reduce((v, key) => obj(v)[key], value);
const keys = (value: unknown): string[] => Object.keys(obj(value)).sort();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(obj(value)).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const read = (name: (typeof names)[number]): Obj => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Obj;

const EXPECTED: Record<string, string> = {
  'scenario.G-v2-1':'ebcdd692563bef41255b8de2df7f5a791717f6a3ae7a1b799e36a11afa5b04f0',
  'scenario.G-v2-2':'25e3c1aa6881135af915f11a8bf95c82a50a97f6509778501a2770b7a93d2283',
  'scenario.G-v2-3':'22042966d3f92a21db31a05320a28c76b50aed6a197f9e5ed4df9a54de1d5954',
  'scenario.G-v2-4':'37283066521df5886984ba5ad0af103b25608b6d4385393dfbcf53e170b55f60',
  'scenario.G-v2-5':'d625010ccbf916a423c86bf223989048f0a97c3c03f5349ae1c1fb18fde27a3b',
  'scenario.G-v2-6':'68aa61773deb82026fbc6e50766c596e973a37d0ffb983925d4ffc0e446e4387',
  'scenario.G-v2-7':'6fa268b74e18cd32d46071f8c907e2ae739a14431a140d01dc41a47aabf1f33f',
  'scenario.G-v2-8':'83291a4c28224d8165cd6551d0ae57cf2b10e2992d7958622dee1bedbbf92cad',
  'scenario.G-v2-9':'cd5995869da521562afeb65346160aacbace27d33a0df321d0fe3bfba8b26331',
  'scenario.G-v2-10':'d817cb44e01f8c7b26cd05b6de9baf620f300342ac8e3e4caf0224bbde1d7d71',
  'binding.ime':'d975af2f457d9acf5028384385b61aeecec559d3c5f437e735842b8d7c31f240',
  'binding.graphemes':'bd995b7831c7f58986dd7ecd3e3768d4211ac88dda3d46256fd5015d22593d3c',
  'binding.origins':'b5fce1f1817240fe2b48df019d019dacb81b5dc85e77e956290e6736e7213ae1',
  'binding.capture':'22f2b3325f85d4cc459f465664fd0179733e3aa93d09f310df884d1c42d60747',
  'binding.ownership':'5f005e33ed92924d8009d7ac5e569e9df3c76246ef612484dcf6e4b0528f89c7',
  'schema.body':'7ac430cf093ae145595f26b725742d61cbd6b7dcaa97b224ca5f2fab3db05b7d',
  'schema.embed':'eb77fd571aabe9811f0948df80b0d5d5482f2043216b434a3f984bcc1b43331e',
  'schema.endpoint':'d215297d7b41181c98bb0fab42470d738ed26f0de3665249534a5f9bf6eb33c0',
  'schema.contributions':'bea14888ff961fad8f5859d223f9f9119df9b9e161b56ac4ba33f4f5f6601bc9',
  'schema.evidenceHashing':'2130a996678729c14dffdac789e940c04609ff3d9b79c440bed657b3f7381ded',
  'schema.collisionRepair':'97e770c937f1ab37bbf75453461602c22d50ad3b8bfad58994654e247f50611a',
  'schema.limits':'fb08dfcf80b04ec193156163fa7e8758a1240622147eccdd169735c706efa2da',
  'schema.atomic':'992e7f645b296737b6152543a49e5ac6a7901a8cb3250656d402713bced53dcc',
  'comparators.definitions':'5a45c25a936ce6afa6e68b798bf6cfd394d3c92c3d33b8b738e5ca12611dee3d',
  'comparators.invocation':'19652a1d0c4454c8d75c43205ff0022f48dc9c8de165613ea40fbcd0553397df',
  'comparators.contracts':'4ee52b9d1f2f27cebaf0d0f831d4977dd5b1385f9dc63562ab242b17d01c11b6',
};

describe('task 2.5 lean v2 descriptor freeze', () => {
  const schema = read(names[0]), binding = read(names[1]), history = read(names[2]), comparators = read(names[3]);
  const artifacts = [schema, binding, history, comparators];
  const freeze = (label: string, value: unknown): void => expect(digest(value)).toBe(EXPECTED[label]);

  test('artifact closure and integrity-only self-hashes remain exact', () => {
    expect(keys(schema)).toEqual(['artifactRole','artifactVersions','atomicRejectionEffects','authority','bodySequence','boundaryCollision','boundaryEmbed','formattingEvidence','formattingWinner','gcEnabled','hashing','integrityHash','limits','markContributions','plainJson','relativeEndpoint','repairEvidence','root','undoManager','version','versions']);
    expect(keys(binding)).toEqual(['artifactRole','groupBoundaries','ime','implementationStatus','integrityHash','offsetUnit','origins','ownership','schemaIntegritySha256','schemaVersion','selection','sequenceMapping','version']);
    expect(keys(history)).toEqual(['artifactRole','atomicRejectionEffects','descriptorPolicy','implementationStatus','integrityHash','managerRules','scenarios','schemaIntegritySha256','schemaVersion','version']);
    expect(keys(comparators)).toEqual(['artifactRole','canonicalSerialization','comparators','definitions','frozenOutputs','implementationStatus','integrityHash','invocationSchema','outputSchema','schemaIntegritySha256','schemaVersion','version']);
    for (const artifact of artifacts) {
      const copy = structuredClone(artifact); delete obj(copy.integrityHash).value;
      expect(keys(at(artifact, 'integrityHash'))).toEqual(['algorithm','purpose','scope','value']);
      expect(digest(copy)).toBe(String(at(artifact, 'integrityHash', 'value')));
      expect(at(artifact, 'integrityHash', 'purpose')).toBe('drift-detection-only');
    }
    for (const artifact of [binding, history, comparators]) {
      expect(artifact.schemaVersion).toBe(schema.version);
      expect(artifact.schemaIntegritySha256).toBe(at(schema, 'integrityHash', 'value'));
    }
  });

  test('complete scenarios and named section inputs match independent digests', () => {
    const scenarios = arr(history.scenarios).map(obj);
    expect(scenarios.map((scenario) => scenario.id)).toEqual(Array.from({length:10},(_,i)=>`G-v2-${i+1}`));
    for (const scenario of scenarios) {
      expect(keys(scenario)).toEqual(['actions','assertions','id','ownerTask']);
      expect(['2.7','2.8']).toContain(String(scenario.ownerTask));
      expect(arr(scenario.actions).length).toBeGreaterThan(0);
      expect(arr(scenario.assertions).length).toBeGreaterThan(0);
      freeze(`scenario.${String(scenario.id)}`, scenario);
    }
    expect(keys(binding.ime)).toEqual(['assertionOwner','fixtures','inputSemantics']);
    expect(keys(binding.selection)).toEqual(['affinityPairs','assertionOwner','assertions','graphemes']);
    freeze('binding.ime', at(binding,'ime','fixtures'));
    freeze('binding.graphemes', at(binding,'selection','graphemes'));
    freeze('binding.origins', binding.origins); freeze('binding.capture', binding.groupBoundaries);
    freeze('binding.ownership', binding.ownership);
    freeze('schema.body', schema.bodySequence); freeze('schema.embed', schema.boundaryEmbed);
    freeze('schema.endpoint', schema.relativeEndpoint); freeze('schema.contributions', schema.markContributions);
    freeze('schema.evidenceHashing', {formattingEvidence:schema.formattingEvidence,hashing:schema.hashing});
    freeze('schema.collisionRepair', {boundaryCollision:schema.boundaryCollision,repairEvidence:schema.repairEvidence});
    freeze('schema.limits', schema.limits); freeze('schema.atomic', schema.atomicRejectionEffects);
    freeze('comparators.definitions', comparators.definitions);
    freeze('comparators.invocation', comparators.invocationSchema);
    freeze('comparators.contracts', comparators.comparators);
    expect(keys(EXPECTED)).toEqual([
      ...Array.from({length:10},(_,i)=>`scenario.G-v2-${i+1}`),
      'binding.ime','binding.graphemes','binding.origins','binding.capture','binding.ownership',
      'schema.body','schema.embed','schema.endpoint','schema.contributions','schema.evidenceHashing',
      'schema.collisionRepair','schema.limits','schema.atomic',
      'comparators.definitions','comparators.invocation','comparators.contracts',
    ].sort());
  });

  test('critical semantics and the common binary invocation stay direct', () => {
    expect(at(schema,'bodySequence','terminalSentinel')).toBe(false);
    expect(at(schema,'bodySequence','join')).toBe('delete exactly one non-first opening boundary');
    expect(at(schema,'relativeEndpoint','validationOrder')).toEqual([
      'containing-payload-byte-bound','value-is-ASCII-string','encoded-character-length-bound',
      'base64url-character-grammar','length-modulo-four-not-one',
      'allocate-and-decode-with-decoded-byte-bound','canonical-base64url-reencode-exact-match',
      'public-Yjs-relative-position-decode','document-envelope-schema-backend-story-binding',
      'checkpoint-lineage','absolute-position-resolution',
    ]);
    expect(at(schema,'hashing','arrayFraming')).toBe(
      'uint32be element count then each UTF-8 element as uint32be byte length plus bytes'
    );
    expect(comparators.invocationSchema).toEqual({
      closedFields:['expected','actual'],
      expectedRef:'$comparator.operandSchema',
      actualRef:'$comparator.operandSchema',
      sameSchemaRequired:true,
    });
    expect(keys(comparators.comparators)).toEqual([
      'atomicRejection','canonicalAuthoredState','decodedSequence','formattingEvidence',
      'localYjsParity','managerStacks','repairEvidence',
    ]);
    for (const contract of Object.values(obj(comparators.comparators)).map(obj)) {
      expect(contract.invocationRef).toBe('invocationSchema');
      expect(contract.operandSchema).toBeDefined();
      expect(contract.outputRef).toBe('outputSchema');
    }
    expect(at(comparators,'comparators','localYjsParity','semanticRoles')).toEqual({expected:'local',actual:'yjs'});
    expect(comparators.outputSchema).toEqual({
      closedFields:['equal','firstDifference'], equal:'boolean',
      firstDifferenceUnion:['null',{closedFields:['path','expected','actual'],
        path:'string matching canonicalSerialization.pathGrammar',
        expectedRef:'canonicalJson',actualRef:'canonicalJson'}],
    });
  });

  test('contains no placeholders, fake outputs, loser leakage, or runtime assertions', () => {
    const text = artifacts.map(canonical).join('\n');
    expect(text).not.toMatch(/canonicalSemanticFingerprint|expectedFingerprint|TODO|TBD|placeholder/i);
    expect(text).not.toMatch(/formattingMetadata|native-attributes|native-format|toDelta/);
    expect(readFileSync(import.meta.path,'utf8')).not.toMatch(/from ['"]\.\.\/src/);
  });
});
