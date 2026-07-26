import { sha256FontBytes } from '@docx-editor.dev/engine-layout';
import type {
  FontConfiguration,
  FontFaceRequest,
  FontSourceSubstitution,
} from '@docx-editor.dev/core-contract/editor';

const FALLBACK_FAMILY = 'DejaVu Sans';
const AUTHORED_DEMO_FAMILIES = Object.freeze([
  'Arial',
  'Calibri',
  'Cambria',
  'Courier New',
  'Declared Missing',
  'Georgia',
  'Times New Roman',
  'Verdana',
]);

const request = (
  family: string,
  weight: number,
  style: FontFaceRequest['style']
): FontFaceRequest => Object.freeze({ family, weight, style });

function demoSubstitutions(): readonly FontSourceSubstitution[] {
  return [
    ...AUTHORED_DEMO_FAMILIES.flatMap((family) =>
      ([400, 700] as const).flatMap((weight) =>
        (['normal', 'italic'] as const).map((style) =>
          Object.freeze({
            from: request(family, weight, style),
            to: request(FALLBACK_FAMILY, weight, 'normal'),
          })
        )
      )
    ),
    ...([400, 700] as const).map((weight) =>
      Object.freeze({
        from: request(FALLBACK_FAMILY, weight, 'italic'),
        to: request(FALLBACK_FAMILY, weight, 'normal'),
      })
    ),
  ];
}

/** Build the demo's immutable, byte-backed HarfBuzz configuration. */
export function createDemoFontConfiguration(
  regularBytes: Uint8Array,
  boldBytes: Uint8Array
): FontConfiguration {
  return Object.freeze({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: Object.freeze([
      {
        request: request(FALLBACK_FAMILY, 400, 'normal'),
        id: 'demo-dejavu-sans-regular',
        bytes: regularBytes,
        hash: sha256FontBytes(regularBytes),
        faceIndex: 0,
      },
      {
        request: request(FALLBACK_FAMILY, 700, 'normal'),
        id: 'demo-dejavu-sans-bold',
        bytes: boldBytes,
        hash: sha256FontBytes(boldBytes),
        faceIndex: 0,
      },
    ]),
    substitutions: demoSubstitutions(),
    defaultFont: Object.freeze({ family: FALLBACK_FAMILY, sizeHalfPoints: 24 }),
    language: 'en',
  });
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Demo font could not be loaded (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Load the two licensed demo faces before constructing either adapter. */
export async function loadDemoFontConfiguration(): Promise<FontConfiguration> {
  const [regular, bold] = await Promise.all([
    fetchBytes(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
    fetchBytes(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)),
  ]);
  return createDemoFontConfiguration(regular, bold);
}
