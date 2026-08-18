import type { Ref } from 'vue';

/** Reactive input accepted by Vue composables. @public */
export type MaybeRefOrGetter<T> = T | Ref<T> | (() => T);
