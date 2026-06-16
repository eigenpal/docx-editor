<template>
  <!--
    "DOCX Editor by EigenPal" lockup — the exact same mark used in the
    docx-editor.dev site header (DocxIcon + wordmark + EigenpalLogo). Kept in
    `examples/shared` so the React + Vue previews show an identical brand.
  -->
  <a
    href="https://docx-editor.dev"
    target="_blank"
    rel="noopener noreferrer"
    class="brand-logo"
    title="DOCX Editor by EigenPal"
  >
    <svg
        class="brand-logo__doc"
        viewBox="0 0 70 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M2 2H48L68 22V78H2V2Z"
          fill="#FAF9F8"
          stroke="#201F1E"
          stroke-width="4"
          stroke-linejoin="round"
        />
        <path
          d="M48 2V22H68"
          fill="#DEECF9"
          stroke="#201F1E"
          stroke-width="4"
          stroke-linejoin="round"
        />
        <path d="M48 2V22H68L48 2Z" fill="#DEECF9" />
        <rect x="13" y="32" width="28" height="4" fill="#201F1E" opacity="0.25" />
        <rect x="13" y="42" width="38" height="4" fill="#201F1E" opacity="0.15" />
        <rect x="13" y="52" width="33" height="4" fill="#201F1E" opacity="0.15" />
        <rect x="13" y="62" width="36" height="4" fill="#201F1E" opacity="0.15" />
        <rect x="13" y="82" width="44" height="16" fill="#185ABD" stroke="#201F1E" stroke-width="3" />
        <text
          x="35"
          y="94"
          text-anchor="middle"
          fill="#FAF9F8"
          font-size="11"
          font-weight="900"
          font-family="system-ui, sans-serif"
        >
          .DOCX
        </text>
      </svg>
    <span class="brand-logo__stack">
      <span class="brand-logo__title">DOCX Editor</span>
      <span class="brand-logo__by">
      by
      <svg
        class="brand-logo__eigenpal"
        viewBox="0 0 69 74"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M32.364 45.8825C35.29 47.5714 37.0926 50.6931 37.0926 54.0715V68.5491C37.0926 71.1596 34.9756 73.276 32.3651 73.2766C29.7542 73.2766 27.6376 71.16 27.6376 68.5491V46.5581C27.6376 45.7883 26.8043 45.3072 26.1376 45.6921L7.09088 56.6887C4.83001 57.9931 1.9397 57.218 0.6344 54.9574C-0.670978 52.6965 0.10259 49.8042 2.36336 48.4986L14.8956 41.2595C17.8209 39.5698 21.4254 39.5692 24.3513 41.2579L32.364 45.8825Z"
          fill="url(#brand-eigenpal-g0)"
        />
        <path
          d="M0.6344 18.3191C1.93969 16.0585 4.82996 15.2833 7.09088 16.5879L27.6376 28.4482V28.4436L41.8202 36.6337L41.8178 36.636L62.3623 48.4986C64.6233 49.8041 65.3989 52.6963 64.0935 54.9574C63.0062 56.8407 60.8194 57.6884 58.812 57.1665L1.35922 23.9954C-0.0945812 22.5178 -0.452422 20.2016 0.6344 18.3191Z"
          fill="url(#brand-eigenpal-g1)"
        />
        <path
          d="M32.3651 0C34.9756 0.000564347 37.0926 2.11693 37.0926 4.72752V26.7138C37.0926 27.4836 37.926 27.9647 38.5927 27.5798L51.4483 20.1566L50.4788 18.4784C49.7749 17.2591 50.6015 15.7268 52.007 15.6461L66.8959 14.7943C68.423 14.707 69.4171 16.3738 68.6133 17.6751L60.661 30.5419C59.9089 31.7588 58.1308 31.7322 57.4154 30.4934L56.1758 28.3467L50.7688 31.4665C47.8438 33.1542 44.2407 33.1537 41.3161 31.4653L32.3653 26.2978C29.4398 24.6088 27.6376 21.4874 27.6376 18.1094V4.72752C27.6376 2.11658 29.7542 0 32.3651 0Z"
          fill="url(#brand-eigenpal-g2)"
        />
        <defs>
          <linearGradient
            v-for="id in ['brand-eigenpal-g0', 'brand-eigenpal-g1', 'brand-eigenpal-g2']"
            :key="id"
            :id="id"
            x1="47.8477"
            y1="52"
            x2="83.3477"
            y2="5"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="#2EB52E" />
            <stop offset="1" stop-color="#2EB52E" stop-opacity="0.51" />
          </linearGradient>
        </defs>
      </svg>
      <span class="brand-logo__vendor">EigenPal</span>
      </span>
    </span>
  </a>
</template>

<script setup lang="ts">
// Presentational only — no props.
</script>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.brand-logo__stack {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
}
.brand-logo__doc {
  width: 19px;
  height: auto;
  flex-shrink: 0;
}
.brand-logo__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.005em;
  color: var(--doc-text);
  white-space: nowrap;
}
.brand-logo__by {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  line-height: 1.1;
  color: var(--doc-text-subtle);
  white-space: nowrap;
}
.brand-logo__eigenpal {
  width: 10px;
  height: 11px;
  flex-shrink: 0;
}
.brand-logo__vendor {
  font-weight: 600;
  color: var(--doc-text);
}
</style>
