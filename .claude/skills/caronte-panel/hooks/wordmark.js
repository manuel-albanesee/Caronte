export const wordmark = [
  "   ###   ###  ####   ###  #   # ##### #####",
  " ## @=\\## @%\\#%\\@%\\## @%\\#%\\ # \\ @\\\\\\#%\\\\\\\\\\",
  " @%\\ \\\\@%\\@%\\@%\\@=\\@%\\@%\\@%#+@\\ +@\\++@%\\+++++",
  " @=\\+ +@=#%=\\@=#=\\\\@=\\@=\\@%%#=\\+ @\\+/@=##/////",
  "#%\\\\+/#%\\@%\\#%\\@\\\\#%\\#%\\#+@%%\\\\+# \\+#%\\\\\\\\:::::",
  "@%\\##/@%\\@%\\@%\\+#+@%\\@=\\@\\/@%\\++@\\ +@%\\++++",
  " @#=\\\\@=\\@=\\@=\\+@\\/@#=\\\\@\\+:@\\+/@\\+ @=###///",
  "  \\\\\\++\\\\+\\\\+\\\\+/\\+:\\\\\\++\\+/ \\+/:\\+/ \\\\\\\\\\:::",
  "   +++//++/++/++/:+/ +++//+/: +/: +/: +++++",
  "    ///:://://://: /: ///::/:  /:  /:  /////",
  "     :::  :: :: ::  :  :::  :   :   :   :::::"
];

const wordmarkColors = {
  '#': '#FFCD7F', '@': '#FFA446', '%': '#FF9934', '=': '#FF932E',
  '\\': '#9C431E', '+': '#7D3418', '/': '#652A17', ':': '#512318',
};
const wordmarkWidth = Math.max(...wordmark.map(row => row.length));
const compactWordmark = [
  " ###  ##  ###   ##  #  # #### ####",
  "# \\\\\\# \\# @\\\\# # \\# @# @\\ \\@\\\\@\\\\\\\\",
  "@\\   @##=\\@## \\@\\ @\\@\\#=\\  @\\ @##",
  " ### @\\\\@\\@\\\\#  ## \\@\\ @\\  @\\ @==#",
  "  +++ +  + +  +  ++  +  +   +  ++++",
];
const compactWidth = Math.max(...compactWordmark.map(row => row.length));
export const githubProfile = 'https://github.com/manuel-albanesee';

export function wordmarkRows(width, height = wordmark.length) {
  const full = height >= wordmark.length && width >= wordmarkWidth;
  const compact = height >= compactWordmark.length && width >= compactWidth;
  const art = full ? wordmark : compact ? compactWordmark : ['CARONTE'.slice(0, width)];
  return art.map(row => {
    const segments = full || compact ? row.match(/(.)\1*/g) : [row];
    return segments.map(text => ({ text, color: wordmarkColors[text[0]] ?? '#FFA446' }));
  });
}
