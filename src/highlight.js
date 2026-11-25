import hljs from 'highlight.js/lib/core';
import cLang from 'highlight.js/lib/languages/c';
import goLang from 'highlight.js/lib/languages/go';
import rustLang from 'highlight.js/lib/languages/rust';
import jsLang from 'highlight.js/lib/languages/javascript';
import tsLang from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('c', cLang);
hljs.registerLanguage('go', goLang);
hljs.registerLanguage('rust', rustLang);
hljs.registerLanguage('javascript', jsLang);
hljs.registerLanguage('typescript', tsLang);

export default hljs;
