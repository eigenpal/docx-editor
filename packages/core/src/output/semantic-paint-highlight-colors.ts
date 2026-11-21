// The colours of the named `w:highlight` values (ST_HighlightColor). A leaf module, so paint
// helpers read it without importing the painter.
export const HIGHLIGHT_COLOR_HEX = new Map<string, string>(
  Object.entries({
    black: '#000000',
    blue: '#0000ff',
    cyan: '#00ffff',
    darkBlue: '#000080',
    darkCyan: '#008080',
    darkGray: '#808080',
    darkGreen: '#008000',
    darkMagenta: '#800080',
    darkRed: '#800000',
    darkYellow: '#808000',
    green: '#00ff00',
    lightGray: '#c0c0c0',
    magenta: '#ff00ff',
    red: '#ff0000',
    yellow: '#ffff00',
    white: '#ffffff',
  })
);
