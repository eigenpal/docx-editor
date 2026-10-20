import {
  defineComponent,
  h,
  Teleport,
  Comment,
  Fragment,
  isVNode,
  onMounted,
  onUpdated,
  onUnmounted,
  shallowRef,
  watch,
  type PropType,
  type VNodeChild,
} from 'vue';
import {
  observeUnsupportedElements,
  type UnsupportedElement,
  type UnsupportedElementHost,
} from '@docx-editor.dev/core/editor';

// Vue emits comments for false v-if branches and fragments for template groups.
// These do not replace the visible built-in fallback.
function hasContent(content: VNodeChild): boolean {
  if (content == null || typeof content === 'boolean') return false;
  if (Array.isArray(content)) return content.some(hasContent);
  if (isVNode(content)) {
    if (content.type === Comment) return false;
    if (content.type === Fragment) return hasContent(content.children as VNodeChild);
    if (typeof content.children === 'string' && typeof content.type === 'symbol') {
      return content.children.trim().length > 0;
    }
    return true;
  }
  return typeof content !== 'string' || content.trim().length > 0;
}

// A winning declaration can mount before the previous winner finishes unmounting.
// Only the current owner can restore this host.
const owners = new WeakMap<UnsupportedElementHost, symbol>();

export const UnsupportedElementPlaceholder = defineComponent({
  props: {
    host: { type: Object as PropType<UnsupportedElementHost>, required: true },
    render: {
      type: Function as PropType<(element: UnsupportedElement) => VNodeChild>,
      required: true,
    },
  },
  setup(props) {
    let custom = false;
    const owner = Symbol('unsupported-host-owner');
    const updateFallback = () => {
      owners.set(props.host, owner);
      props.host.setCustomized(custom);
    };
    onMounted(updateFallback);
    onUpdated(updateFallback);
    onUnmounted(() => {
      if (owners.get(props.host) !== owner) return;
      owners.delete(props.host);
      props.host.setCustomized(false);
    });
    return () => {
      const content = props.render(props.host.unsupported);
      custom = hasContent(content);
      return custom ? h(Teleport, { to: props.host.slot }, [content]) : null;
    };
  },
});

export const UnsupportedElements = defineComponent({
  props: {
    container: { type: Object as PropType<HTMLElement>, required: true },
    render: {
      type: Function as PropType<(element: UnsupportedElement) => VNodeChild>,
      required: true,
    },
  },
  setup(props) {
    const hosts = shallowRef<readonly UnsupportedElementHost[]>([]);
    onUnmounted(() => {
      for (const host of hosts.value) host.setCustomized(false);
    });
    watch(
      () => props.container,
      (container, _, onCleanup) => {
        onCleanup(
          observeUnsupportedElements(container, (next) => {
            hosts.value = next;
          })
        );
      },
      { immediate: true }
    );
    return () =>
      hosts.value.map((host) =>
        h(UnsupportedElementPlaceholder, { key: host.key, host, render: props.render })
      );
  },
});
