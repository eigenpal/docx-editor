import { definePopup } from '../src/editor/popup-renderer';
import { defineComponent } from 'vue';
import type { DocxEditorPopups } from '../src/editor/popup-config';
const Compatible = defineComponent({ props: { open: { type: Boolean, required: true } } });
const Incompatible = defineComponent({
  props: { requiredToken: { type: String, required: true } },
});
const WrongOpen = defineComponent({ props: { open: { type: String, required: true } } });
export const valid: DocxEditorPopups = { pageSetup: definePopup(Compatible) };
export const invalid: DocxEditorPopups = {
  // @ts-expect-error The editor does not supply requiredToken.
  pageSetup: definePopup(Incompatible),
};
export const wrong: DocxEditorPopups = {
  // @ts-expect-error The editor supplies a boolean open prop.
  pageSetup: definePopup(WrongOpen),
};
import { DocxEditorPageSetupDialog } from '../src/editor/DocxEditorPageSetup';
import { DocxEditorParagraphDialog } from '../src/editor/DocxEditorParagraphDialog';
import { DocxEditorTextFormFieldDialog } from '../src/editor/DocxEditorTextFormFieldDialog';
import { DocxEditorContentControlWidget } from '../src/editor/DocxEditorContentControlWidget';
import { DocxEditorInvalidTextFormFieldDialog } from '../src/editor/DocxEditorInvalidTextFormFieldDialog';
export const defaults: DocxEditorPopups = {
  pageSetup: definePopup(DocxEditorPageSetupDialog),
  paragraph: definePopup(DocxEditorParagraphDialog),
  textFormField: definePopup(DocxEditorTextFormFieldDialog),
  contentControlWidget: definePopup(DocxEditorContentControlWidget),
  invalidTextFormField: definePopup(DocxEditorInvalidTextFormFieldDialog),
};
const ExtraRequired = defineComponent({
  props: {
    open: { type: Boolean, required: true },
    requiredToken: { type: String, required: true },
  },
});
export const extraRequired: DocxEditorPopups = {
  // @ts-expect-error Matching open does not supply an additional required token.
  pageSetup: definePopup(ExtraRequired),
};
const RequiredClassName = defineComponent({
  props: { open: { type: Boolean, required: true }, className: { type: String, required: true } },
});
export const requiredOptionalHostProp: DocxEditorPopups = {
  // @ts-expect-error The host may omit className, so it cannot satisfy this component.
  pageSetup: definePopup(RequiredClassName),
};
const Defaulted = defineComponent({
  props: {
    open: { type: Boolean, required: true },
    preset: { type: Boolean, default: true },
    className: { type: String, default: '' },
  },
});
export const defaulted: DocxEditorPopups = { pageSetup: definePopup(Defaulted) };

const RequiredStyle = defineComponent({
  props: { open: { type: Boolean, required: true }, style: { type: String, required: true } },
});
export const requiredStyle: DocxEditorPopups = {
  // @ts-expect-error The host may omit style; inherited Vue attributes must not erase this requirement.
  pageSetup: definePopup(RequiredStyle),
};
const NarrowedStyle = defineComponent({
  props: { open: { type: Boolean, required: true }, style: String },
});
export const narrowedStyle: DocxEditorPopups = {
  // @ts-expect-error A declared string style does not accept the host's CSSProperties value.
  pageSetup: definePopup(NarrowedStyle),
};
const NoProps = defineComponent({ render: () => null });
export const noProps: DocxEditorPopups = {
  equation: definePopup(NoProps),
  pageSetup: definePopup(NoProps),
};
