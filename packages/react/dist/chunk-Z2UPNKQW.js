'use strict';
var chunkUSRMBYI6_js = require('./chunk-USRMBYI6.js'),
  chunkH5NTJZO4_js = require('./chunk-H5NTJZO4.js');
var Lt = chunkH5NTJZO4_js.b((Re) => {
  (function (e) {
    ((e.parser = function (c, s) {
      return new n(c, s);
    }),
      (e.SAXParser = n),
      (e.SAXStream = h),
      (e.createStream = d),
      (e.MAX_BUFFER_LENGTH = 64 * 1024));
    var t = [
      'comment',
      'sgmlDecl',
      'textNode',
      'tagName',
      'doctype',
      'procInstName',
      'procInstBody',
      'entity',
      'attribName',
      'attribValue',
      'cdata',
      'script',
    ];
    e.EVENTS = [
      'text',
      'processinginstruction',
      'sgmldeclaration',
      'doctype',
      'comment',
      'opentagstart',
      'attribute',
      'opentag',
      'closetag',
      'opencdata',
      'cdata',
      'closecdata',
      'error',
      'end',
      'ready',
      'script',
      'opennamespace',
      'closenamespace',
    ];
    function n(c, s) {
      if (!(this instanceof n)) return new n(c, s);
      var F = this;
      (o(F),
        (F.q = F.c = ''),
        (F.bufferCheckPosition = e.MAX_BUFFER_LENGTH),
        (F.encoding = null),
        (F.opt = s || {}),
        (F.opt.lowercase = F.opt.lowercase || F.opt.lowercasetags),
        (F.looseCase = F.opt.lowercase ? 'toLowerCase' : 'toUpperCase'),
        (F.opt.maxEntityCount = F.opt.maxEntityCount || 512),
        (F.opt.maxEntityDepth = F.opt.maxEntityDepth || 4),
        (F.entityCount = F.entityDepth = 0),
        (F.tags = []),
        (F.closed = F.closedRoot = F.sawRoot = false),
        (F.tag = F.error = null),
        (F.strict = !!c),
        (F.noscript = !!(c || F.opt.noscript)),
        (F.state = m.BEGIN),
        (F.strictEntities = F.opt.strictEntities),
        (F.ENTITIES = F.strictEntities ? Object.create(e.XML_ENTITIES) : Object.create(e.ENTITIES)),
        (F.attribList = []),
        F.opt.xmlns && (F.ns = Object.create(k)),
        F.opt.unquotedAttributeValues === void 0 && (F.opt.unquotedAttributeValues = !c),
        (F.trackPosition = F.opt.position !== false),
        F.trackPosition && (F.position = F.line = F.column = 0),
        W(F, 'onready'));
    }
    (Object.create ||
      (Object.create = function (c) {
        function s() {}
        s.prototype = c;
        var F = new s();
        return F;
      }),
      Object.keys ||
        (Object.keys = function (c) {
          var s = [];
          for (var F in c) c.hasOwnProperty(F) && s.push(F);
          return s;
        }));
    function r(c) {
      for (var s = Math.max(e.MAX_BUFFER_LENGTH, 10), F = 0, g = 0, q = t.length; g < q; g++) {
        var Z = c[t[g]].length;
        if (Z > s)
          switch (t[g]) {
            case 'textNode':
              D(c);
              break;
            case 'cdata':
              (j(c, 'oncdata', c.cdata), (c.cdata = ''));
              break;
            case 'script':
              (j(c, 'onscript', c.script), (c.script = ''));
              break;
            default:
              G(c, 'Max buffer length exceeded: ' + t[g]);
          }
        F = Math.max(F, Z);
      }
      var Q = e.MAX_BUFFER_LENGTH - F;
      c.bufferCheckPosition = Q + c.position;
    }
    function o(c) {
      for (var s = 0, F = t.length; s < F; s++) c[t[s]] = '';
    }
    function i(c) {
      (D(c),
        c.cdata !== '' && (j(c, 'oncdata', c.cdata), (c.cdata = '')),
        c.script !== '' && (j(c, 'onscript', c.script), (c.script = '')));
    }
    n.prototype = {
      end: function () {
        ie(this);
      },
      write: Rr,
      resume: function () {
        return ((this.error = null), this);
      },
      close: function () {
        return this.write(null);
      },
      flush: function () {
        i(this);
      },
    };
    var a;
    try {
      a = chunkH5NTJZO4_js.a('stream').Stream;
    } catch {
      a = function () {};
    }
    a || (a = function () {});
    var u = e.EVENTS.filter(function (c) {
      return c !== 'error' && c !== 'end';
    });
    function d(c, s) {
      return new h(c, s);
    }
    function p(c, s) {
      if (c.length >= 2) {
        if (c[0] === 255 && c[1] === 254) return 'utf-16le';
        if (c[0] === 254 && c[1] === 255) return 'utf-16be';
      }
      return c.length >= 3 && c[0] === 239 && c[1] === 187 && c[2] === 191
        ? 'utf8'
        : c.length >= 4
          ? c[0] === 60 && c[1] === 0 && c[2] === 63 && c[3] === 0
            ? 'utf-16le'
            : c[0] === 0 && c[1] === 60 && c[2] === 0 && c[3] === 63
              ? 'utf-16be'
              : 'utf8'
          : s
            ? 'utf8'
            : null;
    }
    function h(c, s) {
      if (!(this instanceof h)) return new h(c, s);
      (a.apply(this), (this._parser = new n(c, s)), (this.writable = true), (this.readable = true));
      var F = this;
      ((this._parser.onend = function () {
        F.emit('end');
      }),
        (this._parser.onerror = function (g) {
          (F.emit('error', g), (F._parser.error = null));
        }),
        (this._decoder = null),
        (this._decoderBuffer = null),
        u.forEach(function (g) {
          Object.defineProperty(F, 'on' + g, {
            get: function () {
              return F._parser['on' + g];
            },
            set: function (q) {
              if (!q) return (F.removeAllListeners(g), (F._parser['on' + g] = q), q);
              F.on(g, q);
            },
            enumerable: true,
            configurable: false,
          });
        }));
    }
    ((h.prototype = Object.create(a.prototype, { constructor: { value: h } })),
      (h.prototype._decodeBuffer = function (c, s) {
        if (
          (this._decoderBuffer &&
            ((c = Buffer.concat([this._decoderBuffer, c])), (this._decoderBuffer = null)),
          !this._decoder)
        ) {
          var F = p(c, s);
          if (!F) return ((this._decoderBuffer = c), '');
          ((this._parser.encoding = F), (this._decoder = new TextDecoder(F)));
        }
        return this._decoder.decode(c, { stream: !s });
      }),
      (h.prototype.write = function (c) {
        if (
          typeof Buffer == 'function' &&
          typeof Buffer.isBuffer == 'function' &&
          Buffer.isBuffer(c)
        )
          c = this._decodeBuffer(c, false);
        else if (this._decoderBuffer) {
          var s = this._decodeBuffer(Buffer.alloc(0), true);
          s && (this._parser.write(s), this.emit('data', s));
        }
        return (this._parser.write(c.toString()), this.emit('data', c), true);
      }),
      (h.prototype.end = function (c) {
        if ((c && c.length && this.write(c), this._decoderBuffer)) {
          var s = this._decodeBuffer(Buffer.alloc(0), true);
          s && (this._parser.write(s), this.emit('data', s));
        } else if (this._decoder) {
          var F = this._decoder.decode();
          F && (this._parser.write(F), this.emit('data', F));
        }
        return (this._parser.end(), true);
      }),
      (h.prototype.on = function (c, s) {
        var F = this;
        return (
          !F._parser['on' + c] &&
            u.indexOf(c) !== -1 &&
            (F._parser['on' + c] = function () {
              var g = arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments);
              (g.splice(0, 0, c), F.emit.apply(F, g));
            }),
          a.prototype.on.call(F, c, s)
        );
      }));
    var w = '[CDATA[',
      E = 'DOCTYPE',
      v = 'http://www.w3.org/XML/1998/namespace',
      y = 'http://www.w3.org/2000/xmlns/',
      k = { xml: v, xmlns: y },
      A =
        /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,
      X =
        /[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/,
      I =
        /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,
      M =
        /[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;
    function x(c) {
      return (
        c === ' ' ||
        c ===
          `
` ||
        c === '\r' ||
        c === '	'
      );
    }
    function C(c) {
      return c === '"' || c === "'";
    }
    function P(c) {
      return c === '>' || x(c);
    }
    function S(c, s) {
      return c.test(s);
    }
    function R(c, s) {
      return !S(c, s);
    }
    var m = 0;
    ((e.STATE = {
      BEGIN: m++,
      BEGIN_WHITESPACE: m++,
      TEXT: m++,
      TEXT_ENTITY: m++,
      OPEN_WAKA: m++,
      SGML_DECL: m++,
      SGML_DECL_QUOTED: m++,
      DOCTYPE: m++,
      DOCTYPE_QUOTED: m++,
      DOCTYPE_DTD: m++,
      DOCTYPE_DTD_QUOTED: m++,
      COMMENT_STARTING: m++,
      COMMENT: m++,
      COMMENT_ENDING: m++,
      COMMENT_ENDED: m++,
      CDATA: m++,
      CDATA_ENDING: m++,
      CDATA_ENDING_2: m++,
      PROC_INST: m++,
      PROC_INST_BODY: m++,
      PROC_INST_ENDING: m++,
      OPEN_TAG: m++,
      OPEN_TAG_SLASH: m++,
      ATTRIB: m++,
      ATTRIB_NAME: m++,
      ATTRIB_NAME_SAW_WHITE: m++,
      ATTRIB_VALUE: m++,
      ATTRIB_VALUE_QUOTED: m++,
      ATTRIB_VALUE_CLOSED: m++,
      ATTRIB_VALUE_UNQUOTED: m++,
      ATTRIB_VALUE_ENTITY_Q: m++,
      ATTRIB_VALUE_ENTITY_U: m++,
      CLOSE_TAG: m++,
      CLOSE_TAG_SAW_WHITE: m++,
      SCRIPT: m++,
      SCRIPT_ENDING: m++,
    }),
      (e.XML_ENTITIES = { amp: '&', gt: '>', lt: '<', quot: '"', apos: "'" }),
      (e.ENTITIES = {
        amp: '&',
        gt: '>',
        lt: '<',
        quot: '"',
        apos: "'",
        AElig: 198,
        Aacute: 193,
        Acirc: 194,
        Agrave: 192,
        Aring: 197,
        Atilde: 195,
        Auml: 196,
        Ccedil: 199,
        ETH: 208,
        Eacute: 201,
        Ecirc: 202,
        Egrave: 200,
        Euml: 203,
        Iacute: 205,
        Icirc: 206,
        Igrave: 204,
        Iuml: 207,
        Ntilde: 209,
        Oacute: 211,
        Ocirc: 212,
        Ograve: 210,
        Oslash: 216,
        Otilde: 213,
        Ouml: 214,
        THORN: 222,
        Uacute: 218,
        Ucirc: 219,
        Ugrave: 217,
        Uuml: 220,
        Yacute: 221,
        aacute: 225,
        acirc: 226,
        aelig: 230,
        agrave: 224,
        aring: 229,
        atilde: 227,
        auml: 228,
        ccedil: 231,
        eacute: 233,
        ecirc: 234,
        egrave: 232,
        eth: 240,
        euml: 235,
        iacute: 237,
        icirc: 238,
        igrave: 236,
        iuml: 239,
        ntilde: 241,
        oacute: 243,
        ocirc: 244,
        ograve: 242,
        oslash: 248,
        otilde: 245,
        ouml: 246,
        szlig: 223,
        thorn: 254,
        uacute: 250,
        ucirc: 251,
        ugrave: 249,
        uuml: 252,
        yacute: 253,
        yuml: 255,
        copy: 169,
        reg: 174,
        nbsp: 160,
        iexcl: 161,
        cent: 162,
        pound: 163,
        curren: 164,
        yen: 165,
        brvbar: 166,
        sect: 167,
        uml: 168,
        ordf: 170,
        laquo: 171,
        not: 172,
        shy: 173,
        macr: 175,
        deg: 176,
        plusmn: 177,
        sup1: 185,
        sup2: 178,
        sup3: 179,
        acute: 180,
        micro: 181,
        para: 182,
        middot: 183,
        cedil: 184,
        ordm: 186,
        raquo: 187,
        frac14: 188,
        frac12: 189,
        frac34: 190,
        iquest: 191,
        times: 215,
        divide: 247,
        OElig: 338,
        oelig: 339,
        Scaron: 352,
        scaron: 353,
        Yuml: 376,
        fnof: 402,
        circ: 710,
        tilde: 732,
        Alpha: 913,
        Beta: 914,
        Gamma: 915,
        Delta: 916,
        Epsilon: 917,
        Zeta: 918,
        Eta: 919,
        Theta: 920,
        Iota: 921,
        Kappa: 922,
        Lambda: 923,
        Mu: 924,
        Nu: 925,
        Xi: 926,
        Omicron: 927,
        Pi: 928,
        Rho: 929,
        Sigma: 931,
        Tau: 932,
        Upsilon: 933,
        Phi: 934,
        Chi: 935,
        Psi: 936,
        Omega: 937,
        alpha: 945,
        beta: 946,
        gamma: 947,
        delta: 948,
        epsilon: 949,
        zeta: 950,
        eta: 951,
        theta: 952,
        iota: 953,
        kappa: 954,
        lambda: 955,
        mu: 956,
        nu: 957,
        xi: 958,
        omicron: 959,
        pi: 960,
        rho: 961,
        sigmaf: 962,
        sigma: 963,
        tau: 964,
        upsilon: 965,
        phi: 966,
        chi: 967,
        psi: 968,
        omega: 969,
        thetasym: 977,
        upsih: 978,
        piv: 982,
        ensp: 8194,
        emsp: 8195,
        thinsp: 8201,
        zwnj: 8204,
        zwj: 8205,
        lrm: 8206,
        rlm: 8207,
        ndash: 8211,
        mdash: 8212,
        lsquo: 8216,
        rsquo: 8217,
        sbquo: 8218,
        ldquo: 8220,
        rdquo: 8221,
        bdquo: 8222,
        dagger: 8224,
        Dagger: 8225,
        bull: 8226,
        hellip: 8230,
        permil: 8240,
        prime: 8242,
        Prime: 8243,
        lsaquo: 8249,
        rsaquo: 8250,
        oline: 8254,
        frasl: 8260,
        euro: 8364,
        image: 8465,
        weierp: 8472,
        real: 8476,
        trade: 8482,
        alefsym: 8501,
        larr: 8592,
        uarr: 8593,
        rarr: 8594,
        darr: 8595,
        harr: 8596,
        crarr: 8629,
        lArr: 8656,
        uArr: 8657,
        rArr: 8658,
        dArr: 8659,
        hArr: 8660,
        forall: 8704,
        part: 8706,
        exist: 8707,
        empty: 8709,
        nabla: 8711,
        isin: 8712,
        notin: 8713,
        ni: 8715,
        prod: 8719,
        sum: 8721,
        minus: 8722,
        lowast: 8727,
        radic: 8730,
        prop: 8733,
        infin: 8734,
        ang: 8736,
        and: 8743,
        or: 8744,
        cap: 8745,
        cup: 8746,
        int: 8747,
        there4: 8756,
        sim: 8764,
        cong: 8773,
        asymp: 8776,
        ne: 8800,
        equiv: 8801,
        le: 8804,
        ge: 8805,
        sub: 8834,
        sup: 8835,
        nsub: 8836,
        sube: 8838,
        supe: 8839,
        oplus: 8853,
        otimes: 8855,
        perp: 8869,
        sdot: 8901,
        lceil: 8968,
        rceil: 8969,
        lfloor: 8970,
        rfloor: 8971,
        lang: 9001,
        rang: 9002,
        loz: 9674,
        spades: 9824,
        clubs: 9827,
        hearts: 9829,
        diams: 9830,
      }),
      Object.keys(e.ENTITIES).forEach(function (c) {
        var s = e.ENTITIES[c],
          F = typeof s == 'number' ? String.fromCharCode(s) : s;
        e.ENTITIES[c] = F;
      }));
    for (var O in e.STATE) e.STATE[e.STATE[O]] = O;
    m = e.STATE;
    function W(c, s, F) {
      c[s] && c[s](F);
    }
    function Y(c) {
      var s = c && c.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);
      return s ? s[2] : null;
    }
    function oe(c) {
      return c ? c.toLowerCase().replace(/[^a-z0-9]/g, '') : null;
    }
    function ue(c, s) {
      let F = oe(c),
        g = oe(s);
      return !F || !g ? true : g === 'utf16' ? F === 'utf16le' || F === 'utf16be' : F === g;
    }
    function $(c, s) {
      if (!(!c.strict || !c.encoding || !s || s.name !== 'xml')) {
        var F = Y(s.body);
        F &&
          !ue(c.encoding, F) &&
          z(
            c,
            'XML declaration encoding ' +
              F +
              ' does not match detected stream encoding ' +
              c.encoding.toUpperCase()
          );
      }
    }
    function j(c, s, F) {
      (c.textNode && D(c), W(c, s, F));
    }
    function D(c) {
      ((c.textNode = B(c.opt, c.textNode)),
        c.textNode && W(c, 'ontext', c.textNode),
        (c.textNode = ''));
    }
    function B(c, s) {
      return (c.trim && (s = s.trim()), c.normalize && (s = s.replace(/\s+/g, ' ')), s);
    }
    function G(c, s) {
      return (
        D(c),
        c.trackPosition &&
          (s +=
            `
Line: ` +
            c.line +
            `
Column: ` +
            c.column +
            `
Char: ` +
            c.c),
        (s = new Error(s)),
        (c.error = s),
        W(c, 'onerror', s),
        c
      );
    }
    function ie(c) {
      return (
        c.sawRoot && !c.closedRoot && z(c, 'Unclosed root tag'),
        c.state !== m.BEGIN &&
          c.state !== m.BEGIN_WHITESPACE &&
          c.state !== m.TEXT &&
          G(c, 'Unexpected end'),
        D(c),
        (c.c = ''),
        (c.closed = true),
        W(c, 'onend'),
        n.call(c, c.strict, c.opt),
        c
      );
    }
    function z(c, s) {
      if (typeof c != 'object' || !(c instanceof n)) throw new Error('bad call to strictFail');
      c.strict && G(c, s);
    }
    function Mr(c) {
      c.strict || (c.tagName = c.tagName[c.looseCase]());
      var s = c.tags[c.tags.length - 1] || c,
        F = (c.tag = { name: c.tagName, attributes: {} });
      (c.opt.xmlns && (F.ns = s.ns), (c.attribList.length = 0), j(c, 'onopentagstart', F));
    }
    function Ye(c, s) {
      var F = c.indexOf(':'),
        g = F < 0 ? ['', c] : c.split(':'),
        q = g[0],
        Z = g[1];
      return (s && c === 'xmlns' && ((q = 'xmlns'), (Z = '')), { prefix: q, local: Z });
    }
    function Ze(c) {
      if (
        (c.strict || (c.attribName = c.attribName[c.looseCase]()),
        c.attribList.indexOf(c.attribName) !== -1 || c.tag.attributes.hasOwnProperty(c.attribName))
      ) {
        c.attribName = c.attribValue = '';
        return;
      }
      if (c.opt.xmlns) {
        var s = Ye(c.attribName, true),
          F = s.prefix,
          g = s.local;
        if (F === 'xmlns')
          if (g === 'xml' && c.attribValue !== v)
            z(
              c,
              'xml: prefix must be bound to ' +
                v +
                `
Actual: ` +
                c.attribValue
            );
          else if (g === 'xmlns' && c.attribValue !== y)
            z(
              c,
              'xmlns: prefix must be bound to ' +
                y +
                `
Actual: ` +
                c.attribValue
            );
          else {
            var q = c.tag,
              Z = c.tags[c.tags.length - 1] || c;
            (q.ns === Z.ns && (q.ns = Object.create(Z.ns)), (q.ns[g] = c.attribValue));
          }
        c.attribList.push([c.attribName, c.attribValue]);
      } else
        ((c.tag.attributes[c.attribName] = c.attribValue),
          j(c, 'onattribute', { name: c.attribName, value: c.attribValue }));
      c.attribName = c.attribValue = '';
    }
    function xe(c, s) {
      if (c.opt.xmlns) {
        var F = c.tag,
          g = Ye(c.tagName);
        ((F.prefix = g.prefix),
          (F.local = g.local),
          (F.uri = F.ns[g.prefix] || ''),
          F.prefix &&
            !F.uri &&
            (z(c, 'Unbound namespace prefix: ' + JSON.stringify(c.tagName)), (F.uri = g.prefix)));
        var q = c.tags[c.tags.length - 1] || c;
        F.ns &&
          q.ns !== F.ns &&
          Object.keys(F.ns).forEach(function (At) {
            j(c, 'onopennamespace', { prefix: At, uri: F.ns[At] });
          });
        for (var Z = 0, Q = c.attribList.length; Z < Q; Z++) {
          var ne = c.attribList[Z],
            re = ne[0],
            de = ne[1],
            J = Ye(re, true),
            me = J.prefix,
            Ir = J.local,
            kt = me === '' ? '' : F.ns[me] || '',
            et = { name: re, value: de, prefix: me, local: Ir, uri: kt };
          (me &&
            me !== 'xmlns' &&
            !kt &&
            (z(c, 'Unbound namespace prefix: ' + JSON.stringify(me)), (et.uri = me)),
            (c.tag.attributes[re] = et),
            j(c, 'onattribute', et));
        }
        c.attribList.length = 0;
      }
      ((c.tag.isSelfClosing = !!s),
        (c.sawRoot = true),
        c.tags.push(c.tag),
        j(c, 'onopentag', c.tag),
        s ||
          (!c.noscript && c.tagName.toLowerCase() === 'script'
            ? (c.state = m.SCRIPT)
            : (c.state = m.TEXT),
          (c.tag = null),
          (c.tagName = '')),
        (c.attribName = c.attribValue = ''),
        (c.attribList.length = 0));
    }
    function Qe(c) {
      if (!c.tagName) {
        (z(c, 'Weird empty close tag.'), (c.textNode += '</>'), (c.state = m.TEXT));
        return;
      }
      if (c.script) {
        if (c.tagName !== 'script') {
          ((c.script += '</' + c.tagName + '>'), (c.tagName = ''), (c.state = m.SCRIPT));
          return;
        }
        (j(c, 'onscript', c.script), (c.script = ''));
      }
      var s = c.tags.length,
        F = c.tagName;
      c.strict || (F = F[c.looseCase]());
      for (var g = F; s--; ) {
        var q = c.tags[s];
        if (q.name !== g) z(c, 'Unexpected close tag');
        else break;
      }
      if (s < 0) {
        (z(c, 'Unmatched closing tag: ' + c.tagName),
          (c.textNode += '</' + c.tagName + '>'),
          (c.state = m.TEXT));
        return;
      }
      c.tagName = F;
      for (var Z = c.tags.length; Z-- > s; ) {
        var Q = (c.tag = c.tags.pop());
        ((c.tagName = c.tag.name), j(c, 'onclosetag', c.tagName));
        var ne = {};
        for (var re in Q.ns) ne[re] = Q.ns[re];
        var de = c.tags[c.tags.length - 1] || c;
        c.opt.xmlns &&
          Q.ns !== de.ns &&
          Object.keys(Q.ns).forEach(function (J) {
            var me = Q.ns[J];
            j(c, 'onclosenamespace', { prefix: J, uri: me });
          });
      }
      (s === 0 && (c.closedRoot = true),
        (c.tagName = c.attribValue = c.attribName = ''),
        (c.attribList.length = 0),
        (c.state = m.TEXT));
    }
    function Pr(c) {
      var s = c.entity,
        F = s.toLowerCase(),
        g,
        q = '';
      return c.ENTITIES[s]
        ? c.ENTITIES[s]
        : c.ENTITIES[F]
          ? c.ENTITIES[F]
          : ((s = F),
            s.charAt(0) === '#' &&
              (s.charAt(1) === 'x'
                ? ((s = s.slice(2)), (g = parseInt(s, 16)), (q = g.toString(16)))
                : ((s = s.slice(1)), (g = parseInt(s, 10)), (q = g.toString(10)))),
            (s = s.replace(/^0+/, '')),
            isNaN(g) || q.toLowerCase() !== s || g < 0 || g > 1114111
              ? (z(c, 'Invalid character entity'), '&' + c.entity + ';')
              : String.fromCodePoint(g));
    }
    function vt(c, s) {
      s === '<'
        ? ((c.state = m.OPEN_WAKA), (c.startTagPosition = c.position))
        : x(s) || (z(c, 'Non-whitespace before first tag.'), (c.textNode = s), (c.state = m.TEXT));
    }
    function Je(c, s) {
      var F = '';
      return (s < c.length && (F = c.charAt(s)), F);
    }
    function Rr(c) {
      var s = this;
      if (this.error) throw this.error;
      if (s.closed) return G(s, 'Cannot write after close. Assign an onready handler.');
      if (c === null) return ie(s);
      typeof c == 'object' && (c = c.toString());
      for (var F = 0, g = ''; (g = Je(c, F++)), (s.c = g), !!g; )
        switch (
          (s.trackPosition &&
            (s.position++,
            g ===
            `
`
              ? (s.line++, (s.column = 0))
              : s.column++),
          s.state)
        ) {
          case m.BEGIN:
            if (((s.state = m.BEGIN_WHITESPACE), g === '\uFEFF')) continue;
            vt(s, g);
            continue;
          case m.BEGIN_WHITESPACE:
            vt(s, g);
            continue;
          case m.TEXT:
            if (s.sawRoot && !s.closedRoot) {
              for (var Z = F - 1; g && g !== '<' && g !== '&'; )
                ((g = Je(c, F++)),
                  g &&
                    s.trackPosition &&
                    (s.position++,
                    g ===
                    `
`
                      ? (s.line++, (s.column = 0))
                      : s.column++));
              s.textNode += c.substring(Z, F - 1);
            }
            g === '<' && !(s.sawRoot && s.closedRoot && !s.strict)
              ? ((s.state = m.OPEN_WAKA), (s.startTagPosition = s.position))
              : (!x(g) && (!s.sawRoot || s.closedRoot) && z(s, 'Text data outside of root node.'),
                g === '&' ? (s.state = m.TEXT_ENTITY) : (s.textNode += g));
            continue;
          case m.SCRIPT:
            g === '<' ? (s.state = m.SCRIPT_ENDING) : (s.script += g);
            continue;
          case m.SCRIPT_ENDING:
            g === '/' ? (s.state = m.CLOSE_TAG) : ((s.script += '<' + g), (s.state = m.SCRIPT));
            continue;
          case m.OPEN_WAKA:
            if (g === '!') ((s.state = m.SGML_DECL), (s.sgmlDecl = ''));
            else if (!x(g))
              if (S(A, g)) ((s.state = m.OPEN_TAG), (s.tagName = g));
              else if (g === '/') ((s.state = m.CLOSE_TAG), (s.tagName = ''));
              else if (g === '?') ((s.state = m.PROC_INST), (s.procInstName = s.procInstBody = ''));
              else {
                if ((z(s, 'Unencoded <'), s.startTagPosition + 1 < s.position)) {
                  var q = s.position - s.startTagPosition;
                  g = new Array(q).join(' ') + g;
                }
                ((s.textNode += '<' + g), (s.state = m.TEXT));
              }
            continue;
          case m.SGML_DECL:
            if (s.sgmlDecl + g === '--') {
              ((s.state = m.COMMENT), (s.comment = ''), (s.sgmlDecl = ''));
              continue;
            }
            s.doctype && s.doctype !== true && s.sgmlDecl
              ? ((s.state = m.DOCTYPE_DTD), (s.doctype += '<!' + s.sgmlDecl + g), (s.sgmlDecl = ''))
              : (s.sgmlDecl + g).toUpperCase() === w
                ? (j(s, 'onopencdata'), (s.state = m.CDATA), (s.sgmlDecl = ''), (s.cdata = ''))
                : (s.sgmlDecl + g).toUpperCase() === E
                  ? ((s.state = m.DOCTYPE),
                    (s.doctype || s.sawRoot) && z(s, 'Inappropriately located doctype declaration'),
                    (s.doctype = ''),
                    (s.sgmlDecl = ''))
                  : g === '>'
                    ? (j(s, 'onsgmldeclaration', s.sgmlDecl), (s.sgmlDecl = ''), (s.state = m.TEXT))
                    : (C(g) && (s.state = m.SGML_DECL_QUOTED), (s.sgmlDecl += g));
            continue;
          case m.SGML_DECL_QUOTED:
            (g === s.q && ((s.state = m.SGML_DECL), (s.q = '')), (s.sgmlDecl += g));
            continue;
          case m.DOCTYPE:
            g === '>'
              ? ((s.state = m.TEXT), j(s, 'ondoctype', s.doctype), (s.doctype = true))
              : ((s.doctype += g),
                g === '['
                  ? (s.state = m.DOCTYPE_DTD)
                  : C(g) && ((s.state = m.DOCTYPE_QUOTED), (s.q = g)));
            continue;
          case m.DOCTYPE_QUOTED:
            ((s.doctype += g), g === s.q && ((s.q = ''), (s.state = m.DOCTYPE)));
            continue;
          case m.DOCTYPE_DTD:
            g === ']'
              ? ((s.doctype += g), (s.state = m.DOCTYPE))
              : g === '<'
                ? ((s.state = m.OPEN_WAKA), (s.startTagPosition = s.position))
                : C(g)
                  ? ((s.doctype += g), (s.state = m.DOCTYPE_DTD_QUOTED), (s.q = g))
                  : (s.doctype += g);
            continue;
          case m.DOCTYPE_DTD_QUOTED:
            ((s.doctype += g), g === s.q && ((s.state = m.DOCTYPE_DTD), (s.q = '')));
            continue;
          case m.COMMENT:
            g === '-' ? (s.state = m.COMMENT_ENDING) : (s.comment += g);
            continue;
          case m.COMMENT_ENDING:
            g === '-'
              ? ((s.state = m.COMMENT_ENDED),
                (s.comment = B(s.opt, s.comment)),
                s.comment && j(s, 'oncomment', s.comment),
                (s.comment = ''))
              : ((s.comment += '-' + g), (s.state = m.COMMENT));
            continue;
          case m.COMMENT_ENDED:
            g !== '>'
              ? (z(s, 'Malformed comment'), (s.comment += '--' + g), (s.state = m.COMMENT))
              : s.doctype && s.doctype !== true
                ? (s.state = m.DOCTYPE_DTD)
                : (s.state = m.TEXT);
            continue;
          case m.CDATA:
            for (var Z = F - 1; g && g !== ']'; )
              ((g = Je(c, F++)),
                g &&
                  s.trackPosition &&
                  (s.position++,
                  g ===
                  `
`
                    ? (s.line++, (s.column = 0))
                    : s.column++));
            ((s.cdata += c.substring(Z, F - 1)), g === ']' && (s.state = m.CDATA_ENDING));
            continue;
          case m.CDATA_ENDING:
            g === ']' ? (s.state = m.CDATA_ENDING_2) : ((s.cdata += ']' + g), (s.state = m.CDATA));
            continue;
          case m.CDATA_ENDING_2:
            g === '>'
              ? (s.cdata && j(s, 'oncdata', s.cdata),
                j(s, 'onclosecdata'),
                (s.cdata = ''),
                (s.state = m.TEXT))
              : g === ']'
                ? (s.cdata += ']')
                : ((s.cdata += ']]' + g), (s.state = m.CDATA));
            continue;
          case m.PROC_INST:
            g === '?'
              ? (s.state = m.PROC_INST_ENDING)
              : x(g)
                ? (s.state = m.PROC_INST_BODY)
                : (s.procInstName += g);
            continue;
          case m.PROC_INST_BODY:
            if (!s.procInstBody && x(g)) continue;
            g === '?' ? (s.state = m.PROC_INST_ENDING) : (s.procInstBody += g);
            continue;
          case m.PROC_INST_ENDING:
            if (g === '>') {
              let de = { name: s.procInstName, body: s.procInstBody };
              ($(s, de),
                j(s, 'onprocessinginstruction', de),
                (s.procInstName = s.procInstBody = ''),
                (s.state = m.TEXT));
            } else ((s.procInstBody += '?' + g), (s.state = m.PROC_INST_BODY));
            continue;
          case m.OPEN_TAG:
            S(X, g)
              ? (s.tagName += g)
              : (Mr(s),
                g === '>'
                  ? xe(s)
                  : g === '/'
                    ? (s.state = m.OPEN_TAG_SLASH)
                    : (x(g) || z(s, 'Invalid character in tag name'), (s.state = m.ATTRIB)));
            continue;
          case m.OPEN_TAG_SLASH:
            g === '>'
              ? (xe(s, true), Qe(s))
              : (z(s, 'Forward-slash in opening tag not followed by >'), (s.state = m.ATTRIB));
            continue;
          case m.ATTRIB:
            if (x(g)) continue;
            g === '>'
              ? xe(s)
              : g === '/'
                ? (s.state = m.OPEN_TAG_SLASH)
                : S(A, g)
                  ? ((s.attribName = g), (s.attribValue = ''), (s.state = m.ATTRIB_NAME))
                  : z(s, 'Invalid attribute name');
            continue;
          case m.ATTRIB_NAME:
            g === '='
              ? (s.state = m.ATTRIB_VALUE)
              : g === '>'
                ? (z(s, 'Attribute without value'), (s.attribValue = s.attribName), Ze(s), xe(s))
                : x(g)
                  ? (s.state = m.ATTRIB_NAME_SAW_WHITE)
                  : S(X, g)
                    ? (s.attribName += g)
                    : z(s, 'Invalid attribute name');
            continue;
          case m.ATTRIB_NAME_SAW_WHITE:
            if (g === '=') s.state = m.ATTRIB_VALUE;
            else {
              if (x(g)) continue;
              (z(s, 'Attribute without value'),
                (s.tag.attributes[s.attribName] = ''),
                (s.attribValue = ''),
                j(s, 'onattribute', { name: s.attribName, value: '' }),
                (s.attribName = ''),
                g === '>'
                  ? xe(s)
                  : S(A, g)
                    ? ((s.attribName = g), (s.state = m.ATTRIB_NAME))
                    : (z(s, 'Invalid attribute name'), (s.state = m.ATTRIB)));
            }
            continue;
          case m.ATTRIB_VALUE:
            if (x(g)) continue;
            C(g)
              ? ((s.q = g), (s.state = m.ATTRIB_VALUE_QUOTED))
              : (s.opt.unquotedAttributeValues || G(s, 'Unquoted attribute value'),
                (s.state = m.ATTRIB_VALUE_UNQUOTED),
                (s.attribValue = g));
            continue;
          case m.ATTRIB_VALUE_QUOTED:
            if (g !== s.q) {
              g === '&' ? (s.state = m.ATTRIB_VALUE_ENTITY_Q) : (s.attribValue += g);
              continue;
            }
            (Ze(s), (s.q = ''), (s.state = m.ATTRIB_VALUE_CLOSED));
            continue;
          case m.ATTRIB_VALUE_CLOSED:
            x(g)
              ? (s.state = m.ATTRIB)
              : g === '>'
                ? xe(s)
                : g === '/'
                  ? (s.state = m.OPEN_TAG_SLASH)
                  : S(A, g)
                    ? (z(s, 'No whitespace between attributes'),
                      (s.attribName = g),
                      (s.attribValue = ''),
                      (s.state = m.ATTRIB_NAME))
                    : z(s, 'Invalid attribute name');
            continue;
          case m.ATTRIB_VALUE_UNQUOTED:
            if (!P(g)) {
              g === '&' ? (s.state = m.ATTRIB_VALUE_ENTITY_U) : (s.attribValue += g);
              continue;
            }
            (Ze(s), g === '>' ? xe(s) : (s.state = m.ATTRIB));
            continue;
          case m.CLOSE_TAG:
            if (s.tagName)
              g === '>'
                ? Qe(s)
                : S(X, g)
                  ? (s.tagName += g)
                  : s.script
                    ? ((s.script += '</' + s.tagName + g), (s.tagName = ''), (s.state = m.SCRIPT))
                    : (x(g) || z(s, 'Invalid tagname in closing tag'),
                      (s.state = m.CLOSE_TAG_SAW_WHITE));
            else {
              if (x(g)) continue;
              R(A, g)
                ? s.script
                  ? ((s.script += '</' + g), (s.state = m.SCRIPT))
                  : z(s, 'Invalid tagname in closing tag.')
                : (s.tagName = g);
            }
            continue;
          case m.CLOSE_TAG_SAW_WHITE:
            if (x(g)) continue;
            g === '>' ? Qe(s) : z(s, 'Invalid characters in closing tag');
            continue;
          case m.TEXT_ENTITY:
          case m.ATTRIB_VALUE_ENTITY_Q:
          case m.ATTRIB_VALUE_ENTITY_U:
            var Q, ne;
            switch (s.state) {
              case m.TEXT_ENTITY:
                ((Q = m.TEXT), (ne = 'textNode'));
                break;
              case m.ATTRIB_VALUE_ENTITY_Q:
                ((Q = m.ATTRIB_VALUE_QUOTED), (ne = 'attribValue'));
                break;
              case m.ATTRIB_VALUE_ENTITY_U:
                ((Q = m.ATTRIB_VALUE_UNQUOTED), (ne = 'attribValue'));
                break;
            }
            if (g === ';') {
              var re = Pr(s);
              s.opt.unparsedEntities && !Object.values(e.XML_ENTITIES).includes(re)
                ? ((s.entityCount += 1) > s.opt.maxEntityCount &&
                    G(s, 'Parsed entity count exceeds max entity count'),
                  (s.entityDepth += 1) > s.opt.maxEntityDepth &&
                    G(s, 'Parsed entity depth exceeds max entity depth'),
                  (s.entity = ''),
                  (s.state = Q),
                  s.write(re),
                  (s.entityDepth -= 1))
                : ((s[ne] += re), (s.entity = ''), (s.state = Q));
            } else
              S(s.entity.length ? M : I, g)
                ? (s.entity += g)
                : (z(s, 'Invalid character in entity name'),
                  (s[ne] += '&' + s.entity + g),
                  (s.entity = ''),
                  (s.state = Q));
            continue;
          default:
            throw new Error(s, 'Unknown state: ' + s.state);
        }
      return (s.position >= s.bufferCheckPosition && r(s), s);
    }
    String.fromCodePoint ||
      (function () {
        var c = String.fromCharCode,
          s = Math.floor,
          F = function () {
            var g = 16384,
              q = [],
              Z,
              Q,
              ne = -1,
              re = arguments.length;
            if (!re) return '';
            for (var de = ''; ++ne < re; ) {
              var J = Number(arguments[ne]);
              if (!isFinite(J) || J < 0 || J > 1114111 || s(J) !== J)
                throw RangeError('Invalid code point: ' + J);
              (J <= 65535
                ? q.push(J)
                : ((J -= 65536), (Z = (J >> 10) + 55296), (Q = (J % 1024) + 56320), q.push(Z, Q)),
                (ne + 1 === re || q.length > g) && ((de += c.apply(null, q)), (q.length = 0)));
            }
            return de;
          };
        Object.defineProperty
          ? Object.defineProperty(String, 'fromCodePoint', {
              value: F,
              configurable: true,
              writable: true,
            })
          : (String.fromCodePoint = F);
      })();
  })(typeof Re > 'u' ? (Re.sax = {}) : Re);
});
var Ie = chunkH5NTJZO4_js.b((ia, Xt) => {
  Xt.exports = {
    isArray: function (e) {
      return Array.isArray
        ? Array.isArray(e)
        : Object.prototype.toString.call(e) === '[object Array]';
    },
  };
});
var Be = chunkH5NTJZO4_js.b((aa, Ot) => {
  var jr = Ie().isArray;
  Ot.exports = {
    copyOptions: function (e) {
      var t,
        n = {};
      for (t in e) e.hasOwnProperty(t) && (n[t] = e[t]);
      return n;
    },
    ensureFlagExists: function (e, t) {
      (!(e in t) || typeof t[e] != 'boolean') && (t[e] = false);
    },
    ensureSpacesExists: function (e) {
      (!('spaces' in e) || (typeof e.spaces != 'number' && typeof e.spaces != 'string')) &&
        (e.spaces = 0);
    },
    ensureAlwaysArrayExists: function (e) {
      (!('alwaysArray' in e) || (typeof e.alwaysArray != 'boolean' && !jr(e.alwaysArray))) &&
        (e.alwaysArray = false);
    },
    ensureKeyExists: function (e, t) {
      (!(e + 'Key' in t) || typeof t[e + 'Key'] != 'string') &&
        (t[e + 'Key'] = t.compact ? '_' + e : e);
    },
    checkFnExists: function (e, t) {
      return e + 'Fn' in t;
    },
  };
});
var at = chunkH5NTJZO4_js.b((sa, zt) => {
  var Ur = Lt(),
    H = Be(),
    Fe = Ie().isArray,
    b,
    it = true,
    L;
  function Kr(e) {
    return (
      (b = H.copyOptions(e)),
      H.ensureFlagExists('ignoreDeclaration', b),
      H.ensureFlagExists('ignoreInstruction', b),
      H.ensureFlagExists('ignoreAttributes', b),
      H.ensureFlagExists('ignoreText', b),
      H.ensureFlagExists('ignoreComment', b),
      H.ensureFlagExists('ignoreCdata', b),
      H.ensureFlagExists('ignoreDoctype', b),
      H.ensureFlagExists('compact', b),
      H.ensureFlagExists('alwaysChildren', b),
      H.ensureFlagExists('addParent', b),
      H.ensureFlagExists('trim', b),
      H.ensureFlagExists('nativeType', b),
      H.ensureFlagExists('nativeTypeAttributes', b),
      H.ensureFlagExists('sanitize', b),
      H.ensureFlagExists('instructionHasAttributes', b),
      H.ensureFlagExists('captureSpacesBetweenElements', b),
      H.ensureAlwaysArrayExists(b),
      H.ensureKeyExists('declaration', b),
      H.ensureKeyExists('instruction', b),
      H.ensureKeyExists('attributes', b),
      H.ensureKeyExists('text', b),
      H.ensureKeyExists('comment', b),
      H.ensureKeyExists('cdata', b),
      H.ensureKeyExists('doctype', b),
      H.ensureKeyExists('type', b),
      H.ensureKeyExists('name', b),
      H.ensureKeyExists('elements', b),
      H.ensureKeyExists('parent', b),
      H.checkFnExists('doctype', b),
      H.checkFnExists('instruction', b),
      H.checkFnExists('cdata', b),
      H.checkFnExists('comment', b),
      H.checkFnExists('text', b),
      H.checkFnExists('instructionName', b),
      H.checkFnExists('elementName', b),
      H.checkFnExists('attributeName', b),
      H.checkFnExists('attributeValue', b),
      H.checkFnExists('attributes', b),
      b
    );
  }
  function Wt(e) {
    var t = Number(e);
    if (!isNaN(t)) return t;
    var n = e.toLowerCase();
    return n === 'true' ? true : n === 'false' ? false : e;
  }
  function ke(e, t) {
    var n;
    if (b.compact) {
      if (
        (!L[b[e + 'Key']] &&
          (Fe(b.alwaysArray) ? b.alwaysArray.indexOf(b[e + 'Key']) !== -1 : b.alwaysArray) &&
          (L[b[e + 'Key']] = []),
        L[b[e + 'Key']] && !Fe(L[b[e + 'Key']]) && (L[b[e + 'Key']] = [L[b[e + 'Key']]]),
        e + 'Fn' in b && typeof t == 'string' && (t = b[e + 'Fn'](t, L)),
        e === 'instruction' && ('instructionFn' in b || 'instructionNameFn' in b))
      ) {
        for (n in t)
          if (t.hasOwnProperty(n))
            if ('instructionFn' in b) t[n] = b.instructionFn(t[n], n, L);
            else {
              var r = t[n];
              (delete t[n], (t[b.instructionNameFn(n, r, L)] = r));
            }
      }
      Fe(L[b[e + 'Key']]) ? L[b[e + 'Key']].push(t) : (L[b[e + 'Key']] = t);
    } else {
      L[b.elementsKey] || (L[b.elementsKey] = []);
      var o = {};
      if (((o[b.typeKey] = e), e === 'instruction')) {
        for (n in t) if (t.hasOwnProperty(n)) break;
        ((o[b.nameKey] = 'instructionNameFn' in b ? b.instructionNameFn(n, t, L) : n),
          b.instructionHasAttributes
            ? ((o[b.attributesKey] = t[n][b.attributesKey]),
              'instructionFn' in b &&
                (o[b.attributesKey] = b.instructionFn(o[b.attributesKey], n, L)))
            : ('instructionFn' in b && (t[n] = b.instructionFn(t[n], n, L)),
              (o[b.instructionKey] = t[n])));
      } else (e + 'Fn' in b && (t = b[e + 'Fn'](t, L)), (o[b[e + 'Key']] = t));
      (b.addParent && (o[b.parentKey] = L), L[b.elementsKey].push(o));
    }
  }
  function Kt(e) {
    if (
      ('attributesFn' in b && e && (e = b.attributesFn(e, L)),
      (b.trim || 'attributeValueFn' in b || 'attributeNameFn' in b || b.nativeTypeAttributes) && e)
    ) {
      var t;
      for (t in e)
        if (
          e.hasOwnProperty(t) &&
          (b.trim && (e[t] = e[t].trim()),
          b.nativeTypeAttributes && (e[t] = Wt(e[t])),
          'attributeValueFn' in b && (e[t] = b.attributeValueFn(e[t], t, L)),
          'attributeNameFn' in b)
        ) {
          var n = e[t];
          (delete e[t], (e[b.attributeNameFn(t, e[t], L)] = n));
        }
    }
    return e;
  }
  function zr(e) {
    var t = {};
    if (e.body && (e.name.toLowerCase() === 'xml' || b.instructionHasAttributes)) {
      for (
        var n = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\w+))\s*/g, r;
        (r = n.exec(e.body)) !== null;
      )
        t[r[1]] = r[2] || r[3] || r[4];
      t = Kt(t);
    }
    if (e.name.toLowerCase() === 'xml') {
      if (b.ignoreDeclaration) return;
      ((L[b.declarationKey] = {}),
        Object.keys(t).length && (L[b.declarationKey][b.attributesKey] = t),
        b.addParent && (L[b.declarationKey][b.parentKey] = L));
    } else {
      if (b.ignoreInstruction) return;
      b.trim && (e.body = e.body.trim());
      var o = {};
      (b.instructionHasAttributes && Object.keys(t).length
        ? ((o[e.name] = {}), (o[e.name][b.attributesKey] = t))
        : (o[e.name] = e.body),
        ke('instruction', o));
    }
  }
  function _t(e, t) {
    var n;
    if (
      (typeof e == 'object' && ((t = e.attributes), (e = e.name)),
      (t = Kt(t)),
      'elementNameFn' in b && (e = b.elementNameFn(e, L)),
      b.compact)
    ) {
      if (((n = {}), !b.ignoreAttributes && t && Object.keys(t).length)) {
        n[b.attributesKey] = {};
        var r;
        for (r in t) t.hasOwnProperty(r) && (n[b.attributesKey][r] = t[r]);
      }
      (!(e in L) &&
        (Fe(b.alwaysArray) ? b.alwaysArray.indexOf(e) !== -1 : b.alwaysArray) &&
        (L[e] = []),
        L[e] && !Fe(L[e]) && (L[e] = [L[e]]),
        Fe(L[e]) ? L[e].push(n) : (L[e] = n));
    } else
      (L[b.elementsKey] || (L[b.elementsKey] = []),
        (n = {}),
        (n[b.typeKey] = 'element'),
        (n[b.nameKey] = e),
        !b.ignoreAttributes && t && Object.keys(t).length && (n[b.attributesKey] = t),
        b.alwaysChildren && (n[b.elementsKey] = []),
        L[b.elementsKey].push(n));
    ((n[b.parentKey] = L), (L = n));
  }
  function Ht(e) {
    b.ignoreText ||
      (!e.trim() && !b.captureSpacesBetweenElements) ||
      (b.trim && (e = e.trim()),
      b.nativeType && (e = Wt(e)),
      b.sanitize && (e = e.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
      ke('text', e));
  }
  function Vt(e) {
    b.ignoreComment || (b.trim && (e = e.trim()), ke('comment', e));
  }
  function jt(e) {
    var t = L[b.parentKey];
    (b.addParent || delete L[b.parentKey], (L = t));
  }
  function Gr(e) {
    b.ignoreCdata || (b.trim && (e = e.trim()), ke('cdata', e));
  }
  function qr(e) {
    b.ignoreDoctype || ((e = e.replace(/^ /, '')), b.trim && (e = e.trim()), ke('doctype', e));
  }
  function Ut(e) {
    e.note = e;
  }
  zt.exports = function (e, t) {
    var n = Ur.parser(true, {}),
      r = {};
    if (
      ((L = r),
      (b = Kr(t)),
      ((n.opt = { strictEntities: true }),
      (n.onopentag = _t),
      (n.ontext = Ht),
      (n.oncomment = Vt),
      (n.onclosetag = jt),
      (n.onerror = Ut),
      (n.oncdata = Gr),
      (n.ondoctype = qr),
      (n.onprocessinginstruction = zr)),
      it)
    )
      n.write(e).close();
    if (r[b.elementsKey]) {
      var o = r[b.elementsKey];
      (delete r[b.elementsKey], (r[b.elementsKey] = o), delete r.text);
    }
    return r;
  };
});
var $t = chunkH5NTJZO4_js.b((la, qt) => {
  var Gt = Be(),
    $r = at();
  function Yr(e) {
    var t = Gt.copyOptions(e);
    return (Gt.ensureSpacesExists(t), t);
  }
  qt.exports = function (e, t) {
    var n, r, o, i;
    return (
      (n = Yr(t)),
      (r = $r(e, n)),
      (i = 'compact' in n && n.compact ? '_parent' : 'parent'),
      'addParent' in n && n.addParent
        ? (o = JSON.stringify(
            r,
            function (a, u) {
              return a === i ? '_' : u;
            },
            n.spaces
          ))
        : (o = JSON.stringify(r, null, n.spaces)),
      o.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    );
  };
});
var lt = chunkH5NTJZO4_js.b((ua, on) => {
  var V = Be(),
    Zr = Ie().isArray,
    ee,
    te;
  function Qr(e) {
    var t = V.copyOptions(e);
    return (
      V.ensureFlagExists('ignoreDeclaration', t),
      V.ensureFlagExists('ignoreInstruction', t),
      V.ensureFlagExists('ignoreAttributes', t),
      V.ensureFlagExists('ignoreText', t),
      V.ensureFlagExists('ignoreComment', t),
      V.ensureFlagExists('ignoreCdata', t),
      V.ensureFlagExists('ignoreDoctype', t),
      V.ensureFlagExists('compact', t),
      V.ensureFlagExists('indentText', t),
      V.ensureFlagExists('indentCdata', t),
      V.ensureFlagExists('indentAttributes', t),
      V.ensureFlagExists('indentInstruction', t),
      V.ensureFlagExists('fullTagEmptyElement', t),
      V.ensureFlagExists('noQuotesForNativeAttributes', t),
      V.ensureSpacesExists(t),
      typeof t.spaces == 'number' && (t.spaces = Array(t.spaces + 1).join(' ')),
      V.ensureKeyExists('declaration', t),
      V.ensureKeyExists('instruction', t),
      V.ensureKeyExists('attributes', t),
      V.ensureKeyExists('text', t),
      V.ensureKeyExists('comment', t),
      V.ensureKeyExists('cdata', t),
      V.ensureKeyExists('doctype', t),
      V.ensureKeyExists('type', t),
      V.ensureKeyExists('name', t),
      V.ensureKeyExists('elements', t),
      V.checkFnExists('doctype', t),
      V.checkFnExists('instruction', t),
      V.checkFnExists('cdata', t),
      V.checkFnExists('comment', t),
      V.checkFnExists('text', t),
      V.checkFnExists('instructionName', t),
      V.checkFnExists('elementName', t),
      V.checkFnExists('attributeName', t),
      V.checkFnExists('attributeValue', t),
      V.checkFnExists('attributes', t),
      V.checkFnExists('fullTagEmptyElement', t),
      t
    );
  }
  function ce(e, t, n) {
    return (
      (!n && e.spaces
        ? `
`
        : '') + Array(t + 1).join(e.spaces)
    );
  }
  function De(e, t, n) {
    if (t.ignoreAttributes) return '';
    'attributesFn' in t && (e = t.attributesFn(e, te, ee));
    var r,
      o,
      i,
      a,
      u = [];
    for (r in e)
      e.hasOwnProperty(r) &&
        e[r] !== null &&
        e[r] !== void 0 &&
        ((a = t.noQuotesForNativeAttributes && typeof e[r] != 'string' ? '' : '"'),
        (o = '' + e[r]),
        (o = o.replace(/"/g, '&quot;')),
        (i = 'attributeNameFn' in t ? t.attributeNameFn(r, o, te, ee) : r),
        u.push(t.spaces && t.indentAttributes ? ce(t, n + 1, false) : ' '),
        u.push(i + '=' + a + ('attributeValueFn' in t ? t.attributeValueFn(o, r, te, ee) : o) + a));
    return (
      e && Object.keys(e).length && t.spaces && t.indentAttributes && u.push(ce(t, n, false)),
      u.join('')
    );
  }
  function Yt(e, t, n) {
    return (
      (ee = e),
      (te = 'xml'),
      t.ignoreDeclaration ? '' : '<?xml' + De(e[t.attributesKey], t, n) + '?>'
    );
  }
  function Zt(e, t, n) {
    if (t.ignoreInstruction) return '';
    var r;
    for (r in e) if (e.hasOwnProperty(r)) break;
    var o = 'instructionNameFn' in t ? t.instructionNameFn(r, e[r], te, ee) : r;
    if (typeof e[r] == 'object')
      return ((ee = e), (te = o), '<?' + o + De(e[r][t.attributesKey], t, n) + '?>');
    var i = e[r] ? e[r] : '';
    return (
      'instructionFn' in t && (i = t.instructionFn(i, r, te, ee)),
      '<?' + o + (i ? ' ' + i : '') + '?>'
    );
  }
  function Qt(e, t) {
    return t.ignoreComment ? '' : '<!--' + ('commentFn' in t ? t.commentFn(e, te, ee) : e) + '-->';
  }
  function Jt(e, t) {
    return t.ignoreCdata
      ? ''
      : '<![CDATA[' +
          ('cdataFn' in t ? t.cdataFn(e, te, ee) : e.replace(']]>', ']]]]><![CDATA[>')) +
          ']]>';
  }
  function en(e, t) {
    return t.ignoreDoctype
      ? ''
      : '<!DOCTYPE ' + ('doctypeFn' in t ? t.doctypeFn(e, te, ee) : e) + '>';
  }
  function st(e, t) {
    return t.ignoreText
      ? ''
      : ((e = '' + e),
        (e = e.replace(/&amp;/g, '&')),
        (e = e.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
        'textFn' in t ? t.textFn(e, te, ee) : e);
  }
  function Jr(e, t) {
    var n;
    if (e.elements && e.elements.length)
      for (n = 0; n < e.elements.length; ++n)
        switch (e.elements[n][t.typeKey]) {
          case 'text':
            if (t.indentText) return true;
            break;
          case 'cdata':
            if (t.indentCdata) return true;
            break;
          case 'instruction':
            if (t.indentInstruction) return true;
            break;
          case 'doctype':
          case 'comment':
          case 'element':
            return true;
          default:
            return true;
        }
    return false;
  }
  function eo(e, t, n) {
    ((ee = e), (te = e.name));
    var r = [],
      o = 'elementNameFn' in t ? t.elementNameFn(e.name, e) : e.name;
    (r.push('<' + o), e[t.attributesKey] && r.push(De(e[t.attributesKey], t, n)));
    var i =
      (e[t.elementsKey] && e[t.elementsKey].length) ||
      (e[t.attributesKey] && e[t.attributesKey]['xml:space'] === 'preserve');
    return (
      i ||
        ('fullTagEmptyElementFn' in t
          ? (i = t.fullTagEmptyElementFn(e.name, e))
          : (i = t.fullTagEmptyElement)),
      i
        ? (r.push('>'),
          e[t.elementsKey] &&
            e[t.elementsKey].length &&
            (r.push(tn(e[t.elementsKey], t, n + 1)), (ee = e), (te = e.name)),
          r.push(
            t.spaces && Jr(e, t)
              ? `
` + Array(n + 1).join(t.spaces)
              : ''
          ),
          r.push('</' + o + '>'))
        : r.push('/>'),
      r.join('')
    );
  }
  function tn(e, t, n, r) {
    return e.reduce(function (o, i) {
      var a = ce(t, n, r && !o);
      switch (i.type) {
        case 'element':
          return o + a + eo(i, t, n);
        case 'comment':
          return o + a + Qt(i[t.commentKey], t);
        case 'doctype':
          return o + a + en(i[t.doctypeKey], t);
        case 'cdata':
          return o + (t.indentCdata ? a : '') + Jt(i[t.cdataKey], t);
        case 'text':
          return o + (t.indentText ? a : '') + st(i[t.textKey], t);
        case 'instruction':
          var u = {};
          return (
            (u[i[t.nameKey]] = i[t.attributesKey] ? i : i[t.instructionKey]),
            o + (t.indentInstruction ? a : '') + Zt(u, t, n)
          );
      }
    }, '');
  }
  function nn(e, t, n) {
    var r;
    for (r in e)
      if (e.hasOwnProperty(r))
        switch (r) {
          case t.parentKey:
          case t.attributesKey:
            break;
          case t.textKey:
            if (t.indentText || n) return true;
            break;
          case t.cdataKey:
            if (t.indentCdata || n) return true;
            break;
          case t.instructionKey:
            if (t.indentInstruction || n) return true;
            break;
          case t.doctypeKey:
          case t.commentKey:
            return true;
          default:
            return true;
        }
    return false;
  }
  function to(e, t, n, r, o) {
    ((ee = e), (te = t));
    var i = 'elementNameFn' in n ? n.elementNameFn(t, e) : t;
    if (typeof e > 'u' || e === null || e === '')
      return ('fullTagEmptyElementFn' in n && n.fullTagEmptyElementFn(t, e)) ||
        n.fullTagEmptyElement
        ? '<' + i + '></' + i + '>'
        : '<' + i + '/>';
    var a = [];
    if (t) {
      if ((a.push('<' + i), typeof e != 'object'))
        return (a.push('>' + st(e, n) + '</' + i + '>'), a.join(''));
      e[n.attributesKey] && a.push(De(e[n.attributesKey], n, r));
      var u =
        nn(e, n, true) || (e[n.attributesKey] && e[n.attributesKey]['xml:space'] === 'preserve');
      if (
        (u ||
          ('fullTagEmptyElementFn' in n
            ? (u = n.fullTagEmptyElementFn(t, e))
            : (u = n.fullTagEmptyElement)),
        u)
      )
        a.push('>');
      else return (a.push('/>'), a.join(''));
    }
    return (
      a.push(rn(e, n, r + 1, false)),
      (ee = e),
      (te = t),
      t && a.push((o ? ce(n, r, false) : '') + '</' + i + '>'),
      a.join('')
    );
  }
  function rn(e, t, n, r) {
    var o,
      i,
      a,
      u = [];
    for (i in e)
      if (e.hasOwnProperty(i))
        for (a = Zr(e[i]) ? e[i] : [e[i]], o = 0; o < a.length; ++o) {
          switch (i) {
            case t.declarationKey:
              u.push(Yt(a[o], t, n));
              break;
            case t.instructionKey:
              u.push((t.indentInstruction ? ce(t, n, r) : '') + Zt(a[o], t, n));
              break;
            case t.attributesKey:
            case t.parentKey:
              break;
            case t.textKey:
              u.push((t.indentText ? ce(t, n, r) : '') + st(a[o], t));
              break;
            case t.cdataKey:
              u.push((t.indentCdata ? ce(t, n, r) : '') + Jt(a[o], t));
              break;
            case t.doctypeKey:
              u.push(ce(t, n, r) + en(a[o], t));
              break;
            case t.commentKey:
              u.push(ce(t, n, r) + Qt(a[o], t));
              break;
            default:
              u.push(ce(t, n, r) + to(a[o], i, t, n, nn(a[o], t)));
          }
          r = r && !u.length;
        }
    return u.join('');
  }
  on.exports = function (e, t) {
    t = Qr(t);
    var n = [];
    return (
      (ee = e),
      (te = '_root_'),
      t.compact
        ? n.push(rn(e, t, 0, true))
        : (e[t.declarationKey] && n.push(Yt(e[t.declarationKey], t, 0)),
          e[t.elementsKey] &&
            e[t.elementsKey].length &&
            n.push(tn(e[t.elementsKey], t, 0, !n.length))),
      n.join('')
    );
  };
});
var sn = chunkH5NTJZO4_js.b((ca, an) => {
  var no = lt();
  an.exports = function (e, t) {
    e instanceof Buffer && (e = e.toString());
    var n = null;
    if (typeof e == 'string')
      try {
        n = JSON.parse(e);
      } catch {
        throw new Error('The JSON structure is invalid');
      }
    else n = e;
    return no(n, t);
  };
});
var un = chunkH5NTJZO4_js.b((fa, ln) => {
  var ro = at(),
    oo = $t(),
    io = lt(),
    ao = sn();
  ln.exports = { xml2js: ro, xml2json: oo, js2xml: io, json2xml: ao };
});
var be = new Set(),
  Pe = new Map(),
  tt = new Set(),
  nt = false;
function Lr(e, t = [400, 700], n = ['normal', 'italic']) {
  let r = encodeURIComponent(e),
    o = [];
  for (let a of n) {
    let u = a === 'italic' ? 1 : 0;
    for (let d of t) o.push(`${u},${d}`);
  }
  o.sort();
  let i = o.join(';');
  return `https://fonts.googleapis.com/css2?family=${r}:ital,wght@${i}&display=swap`;
}
async function rt(e, t) {
  if (typeof document > 'u') return false;
  let n = e.trim();
  if (be.has(n)) return true;
  let r = Pe.get(n);
  if (r) return r;
  let o = (async () => {
    nt = true;
    try {
      let i = Lr(n, t?.weights, t?.styles),
        a = document.createElement('link');
      return (
        (a.rel = 'stylesheet'),
        (a.href = i),
        (await new Promise((d) => {
          ((a.onload = () => d(!0)),
            (a.onerror = () => d(!1)),
            document.head.appendChild(a),
            setTimeout(() => d(!1), 5e3));
        }))
          ? (await Pt(n, 3e3), be.add(n), Mt([n]), !0)
          : !1
      );
    } catch (i) {
      return (console.warn(`Failed to load font "${n}":`, i), false);
    } finally {
      (Pe.delete(n), Pe.size === 0 && (nt = false));
    }
  })();
  return (Pe.set(n, o), o);
}
async function Xr(e, t) {
  let n = e.filter((r) => !be.has(r.trim()));
  n.length !== 0 && (await Promise.all(n.map((r) => rt(r, t))));
}
function Gi(e) {
  return be.has(e.trim());
}
function qi() {
  return nt;
}
function $i() {
  return Array.from(be);
}
function Yi(e) {
  return (
    tt.add(e),
    () => {
      tt.delete(e);
    }
  );
}
function Mt(e) {
  for (let t of tt)
    try {
      t(e);
    } catch (n) {
      console.warn('Font load callback error:', n);
    }
}
async function Pt(e, t) {
  if ('fonts' in document)
    try {
      let n = `400 16px "${e}"`;
      return (
        await Promise.race([document.fonts.load(n), new Promise((r) => setTimeout(r, t))]),
        document.fonts.check(n)
      );
    } catch {}
  return (await new Promise((n) => setTimeout(n, 100)), true);
}
function Zi(e, t = 'sans-serif') {
  if (typeof document > 'u') return false;
  let n = (o, i) => {
    let u = document.createElement('canvas').getContext('2d');
    if (!u) return false;
    u.textBaseline = 'top';
    let d = 'abcdefghijklmnopqrstuvwxyz0123456789';
    u.font = `72px ${i}`;
    let p = u.measureText(d).width;
    return ((u.font = `72px "${o}", ${i}`), u.measureText(d).width !== p);
  };
  return n(e, t) ? true : n(e, t === 'sans-serif' ? 'serif' : 'sans-serif');
}
async function Qi(e, t, n) {
  let r = e.trim();
  if (be.has(r)) return true;
  try {
    let o = new Blob([t], { type: 'font/ttf' }),
      i = URL.createObjectURL(o),
      a = document.createElement('style');
    return (
      (a.textContent = `
      @font-face {
        font-family: "${r}";
        src: url(${i}) format('truetype');
        font-weight: ${n?.weight ?? 'normal'};
        font-style: ${n?.style ?? 'normal'};
        font-display: swap;
      }
    `),
      document.head.appendChild(a),
      await Pt(r, 3e3),
      be.add(r),
      Mt([r]),
      !0
    );
  } catch (o) {
    return (console.warn(`Failed to load font "${r}" from buffer:`, o), false);
  }
}
var Or = {
  Calibri: 'Carlito',
  Cambria: 'Caladea',
  Arial: 'Arimo',
  'Times New Roman': 'Tinos',
  'Courier New': 'Cousine',
  Garamond: 'EB Garamond',
  'Book Antiqua': 'EB Garamond',
  Georgia: 'Tinos',
  Verdana: 'Open Sans',
  Tahoma: 'Open Sans',
  'Trebuchet MS': 'Source Sans Pro',
  'Century Gothic': 'Poppins',
  'Franklin Gothic': 'Libre Franklin',
  Palatino: 'EB Garamond',
  'Palatino Linotype': 'EB Garamond',
  'Lucida Sans': 'Open Sans',
  'Segoe UI': 'Open Sans',
  Impact: 'Anton',
  'Comic Sans MS': 'Comic Neue',
  Consolas: 'Inconsolata',
  'Lucida Console': 'Inconsolata',
  Monaco: 'Fira Code',
};
function _r(e) {
  let t = e.trim();
  return Or[t] || t;
}
async function Hr(e) {
  let t = e.trim(),
    n = _r(t);
  if (n !== t) {
    let r = await rt(n);
    return (r && be.add(t), r);
  }
  return rt(n);
}
async function ot(e) {
  let t = [...new Set(e.map((n) => n.trim()))];
  await Promise.all(t.map((n) => Hr(n)));
}
async function Ji() {
  await Xr(['Carlito', 'Caladea', 'Arimo', 'Tinos', 'Cousine', 'EB Garamond']);
}
function Vr(e) {
  let t = new Set(),
    n = e;
  if (!n?.package) return t;
  let r = n.package?.document?.content;
  if (Array.isArray(r)) {
    for (let i of r)
      if (i?.type === 'paragraph' && Array.isArray(i.content)) {
        for (let a of i.content)
          if (a?.type === 'run' && a.formatting?.fontFamily) {
            let { ascii: u, hAnsi: d } = a.formatting.fontFamily;
            (u && t.add(u), d && d !== u && t.add(d));
          }
      }
  }
  let o = n.package?.styles?.styles;
  if (Array.isArray(o)) {
    for (let i of o)
      if (i?.runProperties?.fontFamily) {
        let { ascii: a, hAnsi: u } = i.runProperties.fontFamily;
        (a && t.add(a), u && u !== a && t.add(u));
      }
  }
  return t;
}
async function ea(e) {
  let t = Vr(e);
  t.size !== 0 && (await ot(Array.from(t)));
}
async function Rt(e) {
  if (e instanceof ArrayBuffer) return e;
  if (e instanceof Uint8Array) {
    let t = new ArrayBuffer(e.byteLength);
    return (new Uint8Array(t).set(e), t);
  }
  if (e instanceof Blob) return e.arrayBuffer();
  throw new TypeError(`Unsupported DocxInput type: ${typeof e}`);
}
var It = chunkH5NTJZO4_js.c(chunkUSRMBYI6_js.a());
async function Bt(e) {
  let t = await It.default.loadAsync(e),
    n = {
      documentXml: null,
      stylesXml: null,
      themeXml: null,
      numberingXml: null,
      fontTableXml: null,
      settingsXml: null,
      webSettingsXml: null,
      headers: new Map(),
      footers: new Map(),
      footnotesXml: null,
      endnotesXml: null,
      commentsXml: null,
      commentsExtensibleXml: null,
      documentRels: null,
      packageRels: null,
      contentTypesXml: null,
      corePropsXml: null,
      appPropsXml: null,
      customPropsXml: null,
      media: new Map(),
      fonts: new Map(),
      allXml: new Map(),
      originalZip: t,
      originalBuffer: e,
    };
  for (let [r, o] of Object.entries(t.files)) {
    if (o.dir) continue;
    let i = r.toLowerCase();
    if (i.endsWith('.xml') || i.endsWith('.rels')) {
      let a = await o.async('text');
      if ((n.allXml.set(r, a), i === 'word/document.xml')) n.documentXml = a;
      else if (i === 'word/styles.xml') n.stylesXml = a;
      else if (i === 'word/theme/theme1.xml') n.themeXml = a;
      else if (i === 'word/numbering.xml') n.numberingXml = a;
      else if (i === 'word/fonttable.xml') n.fontTableXml = a;
      else if (i === 'word/settings.xml') n.settingsXml = a;
      else if (i === 'word/websettings.xml') n.webSettingsXml = a;
      else if (i === 'word/footnotes.xml') n.footnotesXml = a;
      else if (i === 'word/endnotes.xml') n.endnotesXml = a;
      else if (i === 'word/comments.xml') n.commentsXml = a;
      else if (i === 'word/commentsextensible.xml' || i === 'word/commentsextended.xml')
        n.commentsExtensibleXml || (n.commentsExtensibleXml = a);
      else if (i === 'word/_rels/document.xml.rels') n.documentRels = a;
      else if (i === '_rels/.rels') n.packageRels = a;
      else if (i === '[content_types].xml') n.contentTypesXml = a;
      else if (i === 'docprops/core.xml') n.corePropsXml = a;
      else if (i === 'docprops/app.xml') n.appPropsXml = a;
      else if (i === 'docprops/custom.xml') n.customPropsXml = a;
      else if (i.match(/^word\/header\d+\.xml$/)) {
        let u = r.split('/').pop() || r;
        n.headers.set(u, a);
      } else if (i.match(/^word\/footer\d+\.xml$/)) {
        let u = r.split('/').pop() || r;
        n.footers.set(u, a);
      }
    } else if (i.startsWith('word/media/')) {
      let a = await o.async('arraybuffer');
      n.media.set(r, a);
    } else if (i.startsWith('word/fonts/')) {
      let a = await o.async('arraybuffer');
      n.fonts.set(r, a);
    }
  }
  return n;
}
function Dt(e) {
  switch (e.toLowerCase().split('.').pop()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'wmf':
      return 'image/x-wmf';
    case 'emf':
      return 'image/x-emf';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
var Le = chunkH5NTJZO4_js.c(un());
function ae(e) {
  return (0, Le.xml2js)(e, {
    compact: false,
    ignoreComment: true,
    ignoreInstruction: true,
    ignoreDoctype: true,
    alwaysArray: false,
    trim: false,
    captureSpacesBetweenElements: true,
    attributesKey: 'attributes',
    textKey: 'text',
  });
}
function cn(e) {
  return (0, Le.js2xml)({ elements: [e] }, { compact: false, spaces: 0 });
}
function pe(e) {
  try {
    let t = ae(e);
    return t.elements && t.elements.length > 0
      ? (t.elements.find((n) => n.type === 'element') ?? null)
      : t;
  } catch (t) {
    return (console.warn('Failed to parse XML:', t), null);
  }
}
function Te(e) {
  let t = e.indexOf(':');
  return t >= 0 ? e.substring(t + 1) : e;
}
function so(e, t, n) {
  if (!e.name) return false;
  let r = `${t}:${n}`;
  return e.name === r || Te(e.name) === n;
}
function f(e, t, n) {
  if (!e || !e.elements) return null;
  let r = `${t}:${n}`;
  for (let o of e.elements)
    if (o.type === 'element' && (o.name === r || Te(o.name || '') === n)) return o;
  return null;
}
function U(e, t, n) {
  if (!e || !e.elements) return [];
  let r = `${t}:${n}`,
    o = [];
  for (let i of e.elements)
    i.type === 'element' && (i.name === r || Te(i.name || '') === n) && o.push(i);
  return o;
}
function _(e, t) {
  if (!e || !e.elements) return null;
  for (let n of e.elements) if (n.type === 'element' && n.name === t) return n;
  return null;
}
function K(e) {
  return !e || !e.elements ? [] : e.elements.filter((t) => t.type === 'element');
}
function l(e, t, n) {
  if (!e || !e.attributes) return null;
  let r = e.attributes;
  if (t) {
    let o = `${t}:${n}`;
    if (o in r) return r[o];
  }
  return n in r ? r[n] : null;
}
function ge(e) {
  if (!e) return '';
  if ('text' in e && typeof e.text == 'string') return e.text;
  if (!e.elements) return '';
  let t = '';
  for (let n of e.elements)
    n.type === 'text' && 'text' in n ? (t += n.text ?? '') : n.type === 'element' && (t += ge(n));
  return t;
}
function T(e, t, n, r = 1) {
  let o = l(e, t, n);
  if (o === null) return;
  let i = parseInt(o, 10);
  if (!isNaN(i)) return i * r;
}
function N(e, t = 'w') {
  if (!e) return false;
  let n = l(e, t, 'val');
  return n === null ? true : !(n === '0' || n === 'false' || n === 'off');
}
function ut(e, t, n) {
  if (!e) return null;
  if (so(e, t, n)) return e;
  if (e.elements)
    for (let r of e.elements) {
      if (r.type !== 'element') continue;
      let o = ut(r, t, n);
      if (o) return o;
    }
  return null;
}
var Xe = {
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  footnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
  endnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  fontTable: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  webSettings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings',
  oleObject: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  diagramData: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
  officeDocument:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProperties:
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProperties:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  customProperties:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
  customXml: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
};
function Oe(e) {
  let t = new Map();
  if (!e || e.trim().length === 0) return t;
  let n = pe(e);
  if (!n) return (console.warn('Failed to parse relationships XML'), t);
  let r = K(n);
  for (let o of r) {
    let i = o.name || '';
    if (!i.endsWith('Relationship') && !i.includes(':Relationship')) continue;
    let a = l(o, null, 'Id'),
      u = l(o, null, 'Type'),
      d = l(o, null, 'Target'),
      p = l(o, null, 'TargetMode');
    if (!a || !u || !d) {
      console.warn('Relationship missing required attributes:', { id: a, type: u, target: d });
      continue;
    }
    let h = { id: a, type: u, target: d };
    (p === 'External'
      ? (h.targetMode = 'External')
      : p === 'Internal' && (h.targetMode = 'Internal'),
      t.set(a, h));
  }
  return t;
}
function fn(e) {
  return e.type === Xe.hyperlink && e.targetMode === 'External';
}
function ct(e, t) {
  return e.get(t)?.target;
}
var pn = {
    dk1: '000000',
    lt1: 'FFFFFF',
    dk2: '44546A',
    lt2: 'E7E6E6',
    accent1: '4472C4',
    accent2: 'ED7D31',
    accent3: 'A5A5A5',
    accent4: 'FFC000',
    accent5: '5B9BD5',
    accent6: '70AD47',
    hlink: '0563C1',
    folHlink: '954F72',
  },
  _e = {
    majorFont: { latin: 'Calibri Light', ea: '', cs: '', fonts: {} },
    minorFont: { latin: 'Calibri', ea: '', cs: '', fonts: {} },
  },
  ft = { name: 'Office Theme', colorScheme: pn, fontScheme: _e },
  lo = [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ];
function uo(e) {
  if (!e) return null;
  switch (Te(e.name || '')) {
    case 'srgbClr':
      return l(e, 'a', 'val') ?? l(e, null, 'val') ?? null;
    case 'sysClr': {
      let n = l(e, 'a', 'lastClr') ?? l(e, null, 'lastClr');
      if (n) return n;
      switch (l(e, 'a', 'val') ?? l(e, null, 'val')) {
        case 'windowText':
        case 'menuText':
        case 'captionText':
        case 'btnText':
          return '000000';
        case 'window':
        case 'menu':
        case 'btnFace':
        case 'btnHighlight':
          return 'FFFFFF';
        case 'highlight':
          return '0078D7';
        case 'highlightText':
          return 'FFFFFF';
        case 'grayText':
          return '808080';
        default:
          return null;
      }
    }
    case 'schemeClr': {
      l(e, 'a', 'val') ?? l(e, null, 'val');
      return null;
    }
    default:
      return null;
  }
}
function co(e) {
  let t = { ...pn };
  if (!e) return t;
  for (let n of lo) {
    let r = f(e, 'a', n);
    if (r) {
      let o = K(r);
      if (o.length > 0) {
        let i = uo(o[0]);
        i && (t[n] = i);
      }
    }
  }
  return t;
}
function dn(e) {
  let t = { latin: '', ea: '', cs: '', fonts: {} };
  if (!e) return t;
  let n = f(e, 'a', 'latin');
  n && (t.latin = l(n, 'a', 'typeface') ?? l(n, null, 'typeface') ?? '');
  let r = f(e, 'a', 'ea');
  r && (t.ea = l(r, 'a', 'typeface') ?? l(r, null, 'typeface') ?? '');
  let o = f(e, 'a', 'cs');
  o && (t.cs = l(o, 'a', 'typeface') ?? l(o, null, 'typeface') ?? '');
  let i = U(e, 'a', 'font');
  for (let a of i) {
    let u = l(a, 'a', 'script') ?? l(a, null, 'script'),
      d = l(a, 'a', 'typeface') ?? l(a, null, 'typeface');
    u && d && ((t.fonts = t.fonts || {}), (t.fonts[u] = d));
  }
  return t;
}
function fo(e) {
  let t = { ..._e };
  if (!e) return t;
  let n = f(e, 'a', 'majorFont');
  n && (t.majorFont = dn(n));
  let r = f(e, 'a', 'minorFont');
  return (r && (t.minorFont = dn(r)), t);
}
function gn(e) {
  if (!e) return { ...ft };
  try {
    let t = pe(e);
    if (!t) return { ...ft };
    let n = l(t, 'a', 'name') ?? l(t, null, 'name') ?? 'Office Theme',
      r = f(t, 'a', 'themeElements'),
      o = f(r, 'a', 'clrScheme'),
      i = co(o),
      a = f(r, 'a', 'fontScheme'),
      u = fo(a);
    return { name: n, colorScheme: i, fontScheme: u };
  } catch (t) {
    return (console.warn('Failed to parse theme:', t), { ...ft });
  }
}
function mo(e, t = 'latin') {
  if (!e?.fontScheme?.majorFont) return _e.majorFont?.latin ?? 'Calibri Light';
  let n = e.fontScheme.majorFont;
  return t === 'latin'
    ? n.latin || 'Calibri Light'
    : t === 'ea'
      ? n.ea || ''
      : t === 'cs'
        ? n.cs || ''
        : n.fonts?.[t]
          ? n.fonts[t]
          : n.latin || 'Calibri Light';
}
function mn(e, t = 'latin') {
  if (!e?.fontScheme?.minorFont) return _e.minorFont?.latin ?? 'Calibri';
  let n = e.fontScheme.minorFont;
  return t === 'latin'
    ? n.latin || 'Calibri'
    : t === 'ea'
      ? n.ea || ''
      : t === 'cs'
        ? n.cs || ''
        : n.fonts?.[t]
          ? n.fonts[t]
          : n.latin || 'Calibri';
}
function fe(e, t) {
  if (!t) return 'Calibri';
  let n = t.toLowerCase().includes('major'),
    r = t.toLowerCase().includes('minor'),
    o = 'latin',
    i = t.toLowerCase();
  return (
    i.includes('eastasia') ? (o = 'ea') : (i.includes('bidi') || i.includes('cs')) && (o = 'cs'),
    n ? mo(e, o) : r ? mn(e, o) : mn(e, 'latin')
  );
}
function He(e, t) {
  if (!e) return;
  let n = {},
    r = f(e, 'w', 'b');
  r && (n.bold = N(r));
  let o = f(e, 'w', 'bCs');
  o && (n.boldCs = N(o));
  let i = f(e, 'w', 'i');
  i && (n.italic = N(i));
  let a = f(e, 'w', 'iCs');
  a && (n.italicCs = N(a));
  let u = f(e, 'w', 'u');
  if (u) {
    let D = l(u, 'w', 'val');
    if (D) {
      n.underline = { style: D };
      let B = l(u, 'w', 'color'),
        G = l(u, 'w', 'themeColor');
      (B || G) && (n.underline.color = dt(B, G, l(u, 'w', 'themeTint'), l(u, 'w', 'themeShade')));
    }
  }
  let d = f(e, 'w', 'strike');
  d && (n.strike = N(d));
  let p = f(e, 'w', 'dstrike');
  p && (n.doubleStrike = N(p));
  let h = f(e, 'w', 'vertAlign');
  if (h) {
    let D = l(h, 'w', 'val');
    (D === 'superscript' || D === 'subscript' || D === 'baseline') && (n.vertAlign = D);
  }
  let w = f(e, 'w', 'smallCaps');
  w && (n.smallCaps = N(w));
  let E = f(e, 'w', 'caps');
  E && (n.allCaps = N(E));
  let v = f(e, 'w', 'vanish');
  v && (n.hidden = N(v));
  let y = f(e, 'w', 'color');
  y &&
    (n.color = dt(
      l(y, 'w', 'val'),
      l(y, 'w', 'themeColor'),
      l(y, 'w', 'themeTint'),
      l(y, 'w', 'themeShade')
    ));
  let k = f(e, 'w', 'highlight');
  if (k) {
    let D = l(k, 'w', 'val');
    D && (n.highlight = D);
  }
  let A = f(e, 'w', 'shd');
  A && (n.shading = Ve(A));
  let X = f(e, 'w', 'sz');
  if (X) {
    let D = T(X, 'w', 'val');
    D !== void 0 && (n.fontSize = D);
  }
  let I = f(e, 'w', 'szCs');
  if (I) {
    let D = T(I, 'w', 'val');
    D !== void 0 && (n.fontSizeCs = D);
  }
  let M = f(e, 'w', 'rFonts');
  if (M) {
    n.fontFamily = {
      ascii: l(M, 'w', 'ascii') ?? void 0,
      hAnsi: l(M, 'w', 'hAnsi') ?? void 0,
      eastAsia: l(M, 'w', 'eastAsia') ?? void 0,
      cs: l(M, 'w', 'cs') ?? void 0,
    };
    let D = l(M, 'w', 'asciiTheme');
    D &&
      ((n.fontFamily.asciiTheme = D), t && !n.fontFamily.ascii && (n.fontFamily.ascii = fe(t, D)));
    let B = l(M, 'w', 'hAnsiTheme');
    B &&
      ((n.fontFamily.hAnsiTheme = B), t && !n.fontFamily.hAnsi && (n.fontFamily.hAnsi = fe(t, B)));
    let G = l(M, 'w', 'eastAsiaTheme');
    G &&
      ((n.fontFamily.eastAsiaTheme = G),
      t && !n.fontFamily.eastAsia && (n.fontFamily.eastAsia = fe(t, G)));
    let ie = l(M, 'w', 'cstheme');
    ie && ((n.fontFamily.csTheme = ie), t && !n.fontFamily.cs && (n.fontFamily.cs = fe(t, ie)));
  }
  let x = f(e, 'w', 'spacing');
  if (x) {
    let D = T(x, 'w', 'val');
    D !== void 0 && (n.spacing = D);
  }
  let C = f(e, 'w', 'position');
  if (C) {
    let D = T(C, 'w', 'val');
    D !== void 0 && (n.position = D);
  }
  let P = f(e, 'w', 'w');
  if (P) {
    let D = T(P, 'w', 'val');
    D !== void 0 && (n.scale = D);
  }
  let S = f(e, 'w', 'kern');
  if (S) {
    let D = T(S, 'w', 'val');
    D !== void 0 && (n.kerning = D);
  }
  let R = f(e, 'w', 'effect');
  if (R) {
    let D = l(R, 'w', 'val');
    D && (n.effect = D);
  }
  let m = f(e, 'w', 'em');
  if (m) {
    let D = l(m, 'w', 'val');
    D && (n.emphasisMark = D);
  }
  let O = f(e, 'w', 'emboss');
  O && (n.emboss = N(O));
  let W = f(e, 'w', 'imprint');
  W && (n.imprint = N(W));
  let Y = f(e, 'w', 'outline');
  Y && (n.outline = N(Y));
  let oe = f(e, 'w', 'shadow');
  oe && (n.shadow = N(oe));
  let ue = f(e, 'w', 'rtl');
  ue && (n.rtl = N(ue));
  let $ = f(e, 'w', 'cs');
  $ && (n.cs = N($));
  let j = f(e, 'w', 'rStyle');
  if (j) {
    let D = l(j, 'w', 'val');
    D && (n.styleId = D);
  }
  return Object.keys(n).length > 0 ? n : void 0;
}
function dt(e, t, n, r) {
  let o = {};
  return (
    e && e !== 'auto' ? (o.rgb = e) : e === 'auto' && (o.auto = true),
    t && (o.themeColor = t),
    n && (o.themeTint = n),
    r && (o.themeShade = r),
    o
  );
}
function Ve(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'color');
  n && n !== 'auto' && (t.color = { rgb: n });
  let r = l(e, 'w', 'fill');
  r && r !== 'auto' && (t.fill = { rgb: r });
  let o = l(e, 'w', 'themeFill');
  o && ((t.fill = t.fill || {}), (t.fill.themeColor = o));
  let i = l(e, 'w', 'themeFillTint');
  i && t.fill && (t.fill.themeTint = i);
  let a = l(e, 'w', 'themeFillShade');
  a && t.fill && (t.fill.themeShade = a);
  let u = l(e, 'w', 'val');
  return (u && (t.pattern = u), Object.keys(t).length > 0 ? t : void 0);
}
function se(e) {
  if (!e) return;
  let t = l(e, 'w', 'val');
  if (!t) return;
  let n = { style: t },
    r = l(e, 'w', 'color'),
    o = l(e, 'w', 'themeColor');
  (r || o) && (n.color = dt(r, o, l(e, 'w', 'themeTint'), l(e, 'w', 'themeShade')));
  let i = T(e, 'w', 'sz');
  i !== void 0 && (n.size = i);
  let a = T(e, 'w', 'space');
  a !== void 0 && (n.space = a);
  let u = l(e, 'w', 'shadow');
  u && (n.shadow = u === '1' || u === 'true');
  let d = l(e, 'w', 'frame');
  return (d && (n.frame = d === '1' || d === 'true'), n);
}
function po(e) {
  if (!e) return;
  let t = U(e, 'w', 'tab');
  if (t.length === 0) return;
  let n = [];
  for (let r of t) {
    let o = T(r, 'w', 'pos'),
      i = l(r, 'w', 'val');
    if (o !== void 0 && i) {
      let a = { position: o, alignment: i },
        u = l(r, 'w', 'leader');
      (u && (a.leader = u), n.push(a));
    }
  }
  return n.length > 0 ? n : void 0;
}
function mt(e, t) {
  if (!e) return;
  let n = {},
    r = f(e, 'w', 'jc');
  if (r) {
    let C = l(r, 'w', 'val');
    C && (n.alignment = C);
  }
  let o = f(e, 'w', 'bidi');
  o && (n.bidi = N(o));
  let i = f(e, 'w', 'spacing');
  if (i) {
    let C = T(i, 'w', 'before');
    C !== void 0 && (n.spaceBefore = C);
    let P = T(i, 'w', 'after');
    P !== void 0 && (n.spaceAfter = P);
    let S = T(i, 'w', 'line');
    S !== void 0 && (n.lineSpacing = S);
    let R = l(i, 'w', 'lineRule');
    R && (n.lineSpacingRule = R);
    let m = l(i, 'w', 'beforeAutospacing');
    m && (n.beforeAutospacing = m === '1' || m === 'true');
    let O = l(i, 'w', 'afterAutospacing');
    O && (n.afterAutospacing = O === '1' || O === 'true');
  }
  let a = f(e, 'w', 'ind');
  if (a) {
    let C = T(a, 'w', 'left');
    C !== void 0 && (n.indentLeft = C);
    let P = T(a, 'w', 'right');
    P !== void 0 && (n.indentRight = P);
    let S = T(a, 'w', 'firstLine');
    S !== void 0 && (n.indentFirstLine = S);
    let R = T(a, 'w', 'hanging');
    R !== void 0 && ((n.indentFirstLine = -R), (n.hangingIndent = true));
  }
  let u = f(e, 'w', 'pBdr');
  if (u) {
    let C = {},
      P = se(f(u, 'w', 'top'));
    P && (C.top = P);
    let S = se(f(u, 'w', 'bottom'));
    S && (C.bottom = S);
    let R = se(f(u, 'w', 'left'));
    R && (C.left = R);
    let m = se(f(u, 'w', 'right'));
    m && (C.right = m);
    let O = se(f(u, 'w', 'between'));
    O && (C.between = O);
    let W = se(f(u, 'w', 'bar'));
    (W && (C.bar = W), Object.keys(C).length > 0 && (n.borders = C));
  }
  let d = f(e, 'w', 'shd');
  d && (n.shading = Ve(d));
  let p = f(e, 'w', 'tabs');
  p && (n.tabs = po(p));
  let h = f(e, 'w', 'keepNext');
  h && (n.keepNext = N(h));
  let w = f(e, 'w', 'keepLines');
  w && (n.keepLines = N(w));
  let E = f(e, 'w', 'widowControl');
  E && (n.widowControl = N(E));
  let v = f(e, 'w', 'pageBreakBefore');
  v && (n.pageBreakBefore = N(v));
  let y = f(e, 'w', 'contextualSpacing');
  y && (n.contextualSpacing = N(y));
  let k = f(e, 'w', 'numPr');
  if (k) {
    let C = f(k, 'w', 'numId'),
      P = f(k, 'w', 'ilvl');
    if (C || P) {
      if (((n.numPr = {}), C)) {
        let S = T(C, 'w', 'val');
        S !== void 0 && (n.numPr.numId = S);
      }
      if (P) {
        let S = T(P, 'w', 'val');
        S !== void 0 && (n.numPr.ilvl = S);
      }
    }
  }
  let A = f(e, 'w', 'outlineLvl');
  if (A) {
    let C = T(A, 'w', 'val');
    C !== void 0 && (n.outlineLevel = C);
  }
  let X = f(e, 'w', 'pStyle');
  if (X) {
    let C = l(X, 'w', 'val');
    C && (n.styleId = C);
  }
  let I = f(e, 'w', 'suppressLineNumbers');
  I && (n.suppressLineNumbers = N(I));
  let M = f(e, 'w', 'suppressAutoHyphens');
  M && (n.suppressAutoHyphens = N(M));
  let x = f(e, 'w', 'rPr');
  return (x && (n.runProperties = He(x, t)), Object.keys(n).length > 0 ? n : void 0);
}
function he(e) {
  if (!e) return;
  let t = T(e, 'w', 'w'),
    n = l(e, 'w', 'type');
  if (t !== void 0 && n) return { value: t, type: n };
}
function bn(e) {
  if (!e) return;
  let t = {},
    n = se(f(e, 'w', 'top'));
  n && (t.top = n);
  let r = se(f(e, 'w', 'bottom'));
  r && (t.bottom = r);
  let o = se(f(e, 'w', 'left'));
  o && (t.left = o);
  let i = se(f(e, 'w', 'right'));
  i && (t.right = i);
  let a = se(f(e, 'w', 'insideH'));
  a && (t.insideH = a);
  let u = se(f(e, 'w', 'insideV'));
  return (u && (t.insideV = u), Object.keys(t).length > 0 ? t : void 0);
}
function Tn(e) {
  if (!e) return;
  let t = {},
    n = he(f(e, 'w', 'top'));
  n && (t.top = n);
  let r = he(f(e, 'w', 'bottom'));
  r && (t.bottom = r);
  let o = he(f(e, 'w', 'left'));
  o && (t.left = o);
  let i = he(f(e, 'w', 'right'));
  return (i && (t.right = i), Object.keys(t).length > 0 ? t : void 0);
}
function go(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'val');
  if (n) {
    let p = parseInt(n, 16);
    isNaN(p) ||
      ((t.firstRow = (p & 32) !== 0),
      (t.lastRow = (p & 64) !== 0),
      (t.firstColumn = (p & 128) !== 0),
      (t.lastColumn = (p & 256) !== 0),
      (t.noHBand = (p & 512) !== 0),
      (t.noVBand = (p & 1024) !== 0));
  }
  let r = l(e, 'w', 'firstColumn');
  r && (t.firstColumn = r === '1');
  let o = l(e, 'w', 'firstRow');
  o && (t.firstRow = o === '1');
  let i = l(e, 'w', 'lastColumn');
  i && (t.lastColumn = i === '1');
  let a = l(e, 'w', 'lastRow');
  a && (t.lastRow = a === '1');
  let u = l(e, 'w', 'noHBand');
  u && (t.noHBand = u === '1');
  let d = l(e, 'w', 'noVBand');
  return (d && (t.noVBand = d === '1'), Object.keys(t).length > 0 ? t : void 0);
}
function hn(e, t) {
  if (!e) return;
  let n = {},
    r = f(e, 'w', 'tblW');
  r && (n.width = he(r));
  let o = f(e, 'w', 'jc');
  if (o) {
    let y = l(o, 'w', 'val');
    (y === 'left' || y === 'center' || y === 'right') && (n.justification = y);
  }
  let i = f(e, 'w', 'tblCellSpacing');
  i && (n.cellSpacing = he(i));
  let a = f(e, 'w', 'tblInd');
  a && (n.indent = he(a));
  let u = f(e, 'w', 'tblBorders');
  u && (n.borders = bn(u));
  let d = f(e, 'w', 'tblCellMar');
  d && (n.cellMargins = Tn(d));
  let p = f(e, 'w', 'tblLayout');
  if (p) {
    let y = l(p, 'w', 'type');
    (y === 'fixed' || y === 'autofit') && (n.layout = y);
  }
  let h = f(e, 'w', 'tblStyle');
  if (h) {
    let y = l(h, 'w', 'val');
    y && (n.styleId = y);
  }
  let w = f(e, 'w', 'tblLook');
  w && (n.look = go(w));
  let E = f(e, 'w', 'shd');
  E && (n.shading = Ve(E));
  let v = f(e, 'w', 'bidiVisual');
  return (v && (n.bidi = N(v)), Object.keys(n).length > 0 ? n : void 0);
}
function wn(e) {
  if (!e) return;
  let t = {},
    n = f(e, 'w', 'trHeight');
  if (n) {
    t.height = he(n);
    let u = l(n, 'w', 'hRule');
    u && (t.heightRule = u);
  }
  let r = f(e, 'w', 'tblHeader');
  r && (t.header = N(r));
  let o = f(e, 'w', 'cantSplit');
  o && (t.cantSplit = N(o));
  let i = f(e, 'w', 'jc');
  if (i) {
    let u = l(i, 'w', 'val');
    (u === 'left' || u === 'center' || u === 'right') && (t.justification = u);
  }
  let a = f(e, 'w', 'hidden');
  return (a && (t.hidden = N(a)), Object.keys(t).length > 0 ? t : void 0);
}
function yn(e, t) {
  if (!e) return;
  let n = {},
    r = f(e, 'w', 'tcW');
  r && (n.width = he(r));
  let o = f(e, 'w', 'tcBorders');
  o && (n.borders = bn(o));
  let i = f(e, 'w', 'tcMar');
  i && (n.margins = Tn(i));
  let a = f(e, 'w', 'shd');
  a && (n.shading = Ve(a));
  let u = f(e, 'w', 'vAlign');
  if (u) {
    let y = l(u, 'w', 'val');
    (y === 'top' || y === 'center' || y === 'bottom') && (n.verticalAlign = y);
  }
  let d = f(e, 'w', 'textDirection');
  if (d) {
    let y = l(d, 'w', 'val');
    y && (n.textDirection = y);
  }
  let p = f(e, 'w', 'gridSpan');
  if (p) {
    let y = T(p, 'w', 'val');
    y !== void 0 && (n.gridSpan = y);
  }
  let h = f(e, 'w', 'vMerge');
  if (h) {
    let y = l(h, 'w', 'val');
    n.vMerge = y === 'restart' ? 'restart' : 'continue';
  }
  let w = f(e, 'w', 'tcFitText');
  w && (n.fitText = N(w));
  let E = f(e, 'w', 'noWrap');
  E && (n.noWrap = N(E));
  let v = f(e, 'w', 'hideMark');
  return (v && (n.hideMark = N(v)), Object.keys(n).length > 0 ? n : void 0);
}
function ho(e, t) {
  let n = { styleId: l(e, 'w', 'styleId') ?? '', type: l(e, 'w', 'type') ?? 'paragraph' },
    r = l(e, 'w', 'default');
  r && (n.default = r === '1' || r === 'true');
  let o = f(e, 'w', 'name');
  o && (n.name = l(o, 'w', 'val') ?? void 0);
  let i = f(e, 'w', 'basedOn');
  i && (n.basedOn = l(i, 'w', 'val') ?? void 0);
  let a = f(e, 'w', 'next');
  a && (n.next = l(a, 'w', 'val') ?? void 0);
  let u = f(e, 'w', 'link');
  u && (n.link = l(u, 'w', 'val') ?? void 0);
  let d = f(e, 'w', 'uiPriority');
  if (d) {
    let x = T(d, 'w', 'val');
    x !== void 0 && (n.uiPriority = x);
  }
  let p = f(e, 'w', 'hidden');
  p && (n.hidden = N(p));
  let h = f(e, 'w', 'semiHidden');
  h && (n.semiHidden = N(h));
  let w = f(e, 'w', 'unhideWhenUsed');
  w && (n.unhideWhenUsed = N(w));
  let E = f(e, 'w', 'qFormat');
  E && (n.qFormat = N(E));
  let v = f(e, 'w', 'personal');
  v && (n.personal = N(v));
  let y = f(e, 'w', 'pPr');
  y && (n.pPr = mt(y, t));
  let k = f(e, 'w', 'rPr');
  k && (n.rPr = He(k, t));
  let A = f(e, 'w', 'tblPr');
  A && (n.tblPr = hn(A));
  let X = f(e, 'w', 'trPr');
  X && (n.trPr = wn(X));
  let I = f(e, 'w', 'tcPr');
  I && (n.tcPr = yn(I));
  let M = U(e, 'w', 'tblStylePr');
  if (M.length > 0) {
    n.tblStylePr = [];
    for (let x of M) {
      let C = l(x, 'w', 'type');
      if (C) {
        let P = { type: C },
          S = f(x, 'w', 'pPr');
        S && (P.pPr = mt(S, t));
        let R = f(x, 'w', 'rPr');
        R && (P.rPr = He(R, t));
        let m = f(x, 'w', 'tblPr');
        m && (P.tblPr = hn(m));
        let O = f(x, 'w', 'trPr');
        O && (P.trPr = wn(O));
        let W = f(x, 'w', 'tcPr');
        (W && (P.tcPr = yn(W)), n.tblStylePr.push(P));
      }
    }
  }
  return n;
}
function wo(e, t) {
  if (!e) return;
  let n = {},
    r = f(e, 'w', 'rPrDefault');
  if (r) {
    let i = f(r, 'w', 'rPr');
    i && (n.rPr = He(i, t));
  }
  let o = f(e, 'w', 'pPrDefault');
  if (o) {
    let i = f(o, 'w', 'pPr');
    i && (n.pPr = mt(i, t));
  }
  return n.rPr || n.pPr ? n : void 0;
}
function xn(e, t) {
  if (!t) return e;
  if (!e) return t ? { ...t } : void 0;
  let n = { ...e };
  for (let r of Object.keys(t)) {
    let o = t[r];
    o !== void 0 && (n[r] = typeof o == 'object' && o !== null ? { ...(n[r] || {}), ...o } : o);
  }
  return n;
}
function yo(e, t) {
  if (!t) return e;
  if (!e) return t ? { ...t } : void 0;
  let n = { ...e };
  for (let r of Object.keys(t)) {
    let o = t[r];
    if (o !== void 0)
      if (r === 'runProperties') n.runProperties = xn(n.runProperties, t.runProperties);
      else if (r === 'borders' || r === 'numPr' || r === 'frame') {
        let i = n[r],
          a = o;
        n[r] = { ...(i || {}), ...(a || {}) };
      } else r === 'tabs' && Array.isArray(o) ? (n.tabs = [...o]) : (n[r] = o);
  }
  return n;
}
function Fn(e, t, n, r = new Set()) {
  if (r.has(e.styleId) || (r.add(e.styleId), !e.basedOn)) return e;
  let o = t.get(e.basedOn);
  if (!o) return e;
  let i = Fn(o, t, n, r),
    a = { ...e, pPr: yo(i.pPr, e.pPr), rPr: xn(i.rPr, e.rPr) };
  return (
    e.type === 'table' &&
      ((i.tblPr || e.tblPr) && (a.tblPr = { ...(i.tblPr || {}), ...(e.tblPr || {}) }),
      (i.trPr || e.trPr) && (a.trPr = { ...(i.trPr || {}), ...(e.trPr || {}) }),
      (i.tcPr || e.tcPr) && (a.tcPr = { ...(i.tcPr || {}), ...(e.tcPr || {}) })),
    a
  );
}
function pt(e, t) {
  let n = new Map();
  try {
    let r = pe(e);
    if (!r) return n;
    let o = U(r, 'w', 'style');
    for (let i of o) {
      let a = ho(i, t);
      a.styleId && n.set(a.styleId, a);
    }
    for (let [i, a] of n) {
      let u = Fn(a, n, t);
      n.set(i, u);
    }
  } catch (r) {
    console.warn('Failed to parse styles:', r);
  }
  return n;
}
function En(e, t) {
  let n = { styles: [] };
  try {
    let r = pe(e);
    if (!r) return n;
    let o = f(r, 'w', 'docDefaults');
    n.docDefaults = wo(o, t);
    let i = f(r, 'w', 'latentStyles');
    i &&
      (n.latentStyles = {
        defLockedState: l(i, 'w', 'defLockedState') === '1',
        defUIPriority: T(i, 'w', 'defUIPriority'),
        defSemiHidden: l(i, 'w', 'defSemiHidden') === '1',
        defUnhideWhenUsed: l(i, 'w', 'defUnhideWhenUsed') === '1',
        defQFormat: l(i, 'w', 'defQFormat') === '1',
        count: T(i, 'w', 'count'),
      });
    let a = pt(e, t);
    n.styles = Array.from(a.values());
  } catch (r) {
    console.warn('Failed to parse style definitions:', r);
  }
  return n;
}
function Cn(e) {
  let t = { abstractNums: [], nums: [] };
  if (!e) return gt(t);
  let n = pe(e);
  if (!n) return gt(t);
  let r = U(n, 'w', 'abstractNum');
  for (let i of r) {
    let a = bo(i);
    a && t.abstractNums.push(a);
  }
  let o = U(n, 'w', 'num');
  for (let i of o) {
    let a = To(i);
    a && t.nums.push(a);
  }
  return gt(t);
}
function bo(e) {
  let t = l(e, 'w', 'abstractNumId');
  if (t === null) return null;
  let n = parseInt(t, 10);
  if (isNaN(n)) return null;
  let r = { abstractNumId: n, levels: [] },
    o = f(e, 'w', 'multiLevelType');
  if (o) {
    let p = l(o, 'w', 'val');
    (p === 'hybridMultilevel' || p === 'multilevel' || p === 'singleLevel') &&
      (r.multiLevelType = p);
  }
  let i = f(e, 'w', 'name');
  i && (r.name = l(i, 'w', 'val') ?? void 0);
  let a = f(e, 'w', 'numStyleLink');
  a && (r.numStyleLink = l(a, 'w', 'val') ?? void 0);
  let u = f(e, 'w', 'styleLink');
  u && (r.styleLink = l(u, 'w', 'val') ?? void 0);
  let d = U(e, 'w', 'lvl');
  for (let p of d) {
    let h = Sn(p);
    h && r.levels.push(h);
  }
  return (r.levels.sort((p, h) => p.ilvl - h.ilvl), r);
}
function To(e) {
  let t = l(e, 'w', 'numId');
  if (t === null) return null;
  let n = parseInt(t, 10);
  if (isNaN(n)) return null;
  let r = f(e, 'w', 'abstractNumId');
  if (!r) return null;
  let o = l(r, 'w', 'val');
  if (o === null) return null;
  let i = parseInt(o, 10);
  if (isNaN(i)) return null;
  let a = { numId: n, abstractNumId: i },
    u = U(e, 'w', 'lvlOverride');
  if (u.length > 0) {
    a.levelOverrides = [];
    for (let d of u) {
      let p = l(d, 'w', 'ilvl');
      if (p === null) continue;
      let h = parseInt(p, 10);
      if (isNaN(h)) continue;
      let w = { ilvl: h },
        E = f(d, 'w', 'startOverride');
      if (E) {
        let y = l(E, 'w', 'val');
        if (y !== null) {
          let k = parseInt(y, 10);
          isNaN(k) || (w.startOverride = k);
        }
      }
      let v = f(d, 'w', 'lvl');
      (v && (w.lvl = Sn(v) ?? void 0), a.levelOverrides.push(w));
    }
  }
  return a;
}
function Sn(e) {
  let t = l(e, 'w', 'ilvl');
  if (t === null) return null;
  let n = parseInt(t, 10);
  if (isNaN(n) || n < 0 || n > 8) return null;
  let r = { ilvl: n, numFmt: 'decimal', lvlText: '' },
    o = f(e, 'w', 'start');
  if (o) {
    let y = l(o, 'w', 'val');
    if (y !== null) {
      let k = parseInt(y, 10);
      isNaN(k) || (r.start = k);
    }
  }
  let i = f(e, 'w', 'numFmt');
  if (i) {
    let y = l(i, 'w', 'val');
    y && (r.numFmt = xo(y));
  }
  let a = f(e, 'w', 'lvlText');
  a && (r.lvlText = l(a, 'w', 'val') ?? '');
  let u = f(e, 'w', 'lvlJc');
  if (u) {
    let y = l(u, 'w', 'val');
    (y === 'left' || y === 'center' || y === 'right') && (r.lvlJc = y);
  }
  let d = f(e, 'w', 'suff');
  if (d) {
    let y = l(d, 'w', 'val');
    (y === 'tab' || y === 'space' || y === 'nothing') && (r.suffix = y);
  }
  let p = f(e, 'w', 'isLgl');
  p && (r.isLgl = N(p));
  let h = f(e, 'w', 'lvlRestart');
  if (h) {
    let y = l(h, 'w', 'val');
    if (y !== null) {
      let k = parseInt(y, 10);
      isNaN(k) || (r.lvlRestart = k);
    }
  }
  let w = f(e, 'w', 'legacy');
  w &&
    (r.legacy = {
      legacy: N(w),
      legacySpace: T(w, 'w', 'legacySpace'),
      legacyIndent: T(w, 'w', 'legacyIndent'),
    });
  let E = f(e, 'w', 'pPr');
  E && (r.pPr = Fo(E));
  let v = f(e, 'w', 'rPr');
  return (v && (r.rPr = So(v)), r);
}
function xo(e) {
  return (
    {
      decimal: 'decimal',
      upperRoman: 'upperRoman',
      lowerRoman: 'lowerRoman',
      upperLetter: 'upperLetter',
      lowerLetter: 'lowerLetter',
      ordinal: 'ordinal',
      cardinalText: 'cardinalText',
      ordinalText: 'ordinalText',
      hex: 'hex',
      chicago: 'chicago',
      bullet: 'bullet',
      none: 'none',
      decimalZero: 'decimalZero',
      ganada: 'ganada',
      chosung: 'chosung',
      ideographDigital: 'ideographDigital',
      japaneseCounting: 'japaneseCounting',
      aiueo: 'aiueo',
      iroha: 'iroha',
      decimalFullWidth: 'decimalFullWidth',
      decimalHalfWidth: 'decimalHalfWidth',
      japaneseLegal: 'japaneseLegal',
      japaneseDigitalTenThousand: 'japaneseDigitalTenThousand',
      decimalEnclosedCircle: 'decimalEnclosedCircle',
      decimalFullWidth2: 'decimalFullWidth2',
      aiueoFullWidth: 'aiueoFullWidth',
      irohaFullWidth: 'irohaFullWidth',
      decimalEnclosedFullstop: 'decimalEnclosedFullstop',
      decimalEnclosedParen: 'decimalEnclosedParen',
      decimalEnclosedCircleChinese: 'decimalEnclosedCircleChinese',
      ideographEnclosedCircle: 'ideographEnclosedCircle',
      ideographTraditional: 'ideographTraditional',
      ideographZodiac: 'ideographZodiac',
      ideographZodiacTraditional: 'ideographZodiacTraditional',
      taiwaneseCounting: 'taiwaneseCounting',
      ideographLegalTraditional: 'ideographLegalTraditional',
      taiwaneseCountingThousand: 'taiwaneseCountingThousand',
      taiwaneseDigital: 'taiwaneseDigital',
      chineseCounting: 'chineseCounting',
      chineseLegalSimplified: 'chineseLegalSimplified',
      chineseCountingThousand: 'chineseCountingThousand',
      koreanDigital: 'koreanDigital',
      koreanCounting: 'koreanCounting',
      koreanLegal: 'koreanLegal',
      koreanDigital2: 'koreanDigital2',
      vietnameseCounting: 'vietnameseCounting',
      russianLower: 'russianLower',
      russianUpper: 'russianUpper',
      numberInDash: 'numberInDash',
      hebrew1: 'hebrew1',
      hebrew2: 'hebrew2',
      arabicAlpha: 'arabicAlpha',
      arabicAbjad: 'arabicAbjad',
      hindiVowels: 'hindiVowels',
      hindiConsonants: 'hindiConsonants',
      hindiNumbers: 'hindiNumbers',
      hindiCounting: 'hindiCounting',
      thaiLetters: 'thaiLetters',
      thaiNumbers: 'thaiNumbers',
      thaiCounting: 'thaiCounting',
    }[e] ?? 'decimal'
  );
}
function Fo(e) {
  let t = {},
    n = f(e, 'w', 'ind');
  if (n) {
    let o = T(n, 'w', 'left'),
      i = T(n, 'w', 'right'),
      a = T(n, 'w', 'firstLine'),
      u = T(n, 'w', 'hanging');
    (o !== void 0 && (t.indentLeft = o),
      i !== void 0 && (t.indentRight = i),
      u !== void 0
        ? ((t.indentFirstLine = -u), (t.hangingIndent = true))
        : a !== void 0 && (t.indentFirstLine = a));
  }
  let r = f(e, 'w', 'tabs');
  if (r) {
    t.tabs = [];
    let o = U(r, 'w', 'tab');
    for (let i of o) {
      let a = T(i, 'w', 'pos'),
        u = l(i, 'w', 'val'),
        d = l(i, 'w', 'leader');
      a !== void 0 && u && t.tabs.push({ position: a, alignment: Eo(u), leader: Co(d) });
    }
  }
  return t;
}
function Eo(e) {
  switch (e) {
    case 'left':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'decimal':
      return 'decimal';
    case 'bar':
      return 'bar';
    case 'clear':
      return 'clear';
    case 'num':
      return 'num';
    default:
      return 'left';
  }
}
function Co(e) {
  if (e)
    switch (e) {
      case 'none':
        return 'none';
      case 'dot':
        return 'dot';
      case 'hyphen':
        return 'hyphen';
      case 'underscore':
        return 'underscore';
      case 'heavy':
        return 'heavy';
      case 'middleDot':
        return 'middleDot';
      default:
        return;
    }
}
function So(e) {
  let t = {},
    n = f(e, 'w', 'rFonts');
  n &&
    (t.fontFamily = {
      ascii: l(n, 'w', 'ascii') ?? void 0,
      hAnsi: l(n, 'w', 'hAnsi') ?? void 0,
      eastAsia: l(n, 'w', 'eastAsia') ?? void 0,
      cs: l(n, 'w', 'cs') ?? void 0,
    });
  let r = f(e, 'w', 'sz');
  if (r) {
    let d = T(r, 'w', 'val');
    d !== void 0 && (t.fontSize = d);
  }
  let o = f(e, 'w', 'color');
  if (o) {
    let d = l(o, 'w', 'val'),
      p = l(o, 'w', 'themeColor');
    d === 'auto'
      ? (t.color = { auto: true })
      : p
        ? (t.color = {
            themeColor: p,
            themeTint: l(o, 'w', 'themeTint') ?? void 0,
            themeShade: l(o, 'w', 'themeShade') ?? void 0,
          })
        : d && (t.color = { rgb: d });
  }
  let i = f(e, 'w', 'b');
  i && (t.bold = N(i));
  let a = f(e, 'w', 'i');
  a && (t.italic = N(a));
  let u = f(e, 'w', 'vanish');
  return (u && (t.hidden = N(u)), t);
}
function gt(e) {
  let t = new Map();
  for (let r of e.abstractNums) t.set(r.abstractNumId, r);
  let n = new Map();
  for (let r of e.nums) n.set(r.numId, r);
  return {
    definitions: e,
    getLevel(r, o) {
      let i = n.get(r);
      if (!i) return null;
      if (i.levelOverrides) {
        let u = i.levelOverrides.find((d) => d.ilvl === o);
        if (u) {
          if (u.lvl) return u.lvl;
          let d = t.get(i.abstractNumId);
          if (d) {
            let p = d.levels.find((h) => h.ilvl === o);
            if (p && u.startOverride !== void 0) return { ...p, start: u.startOverride };
          }
        }
      }
      let a = t.get(i.abstractNumId);
      if (!a) return null;
      if (a.numStyleLink && a.levels.length === 0) {
        for (let u of t.values())
          if (u.styleLink === a.numStyleLink && u.levels.length > 0) {
            a = u;
            break;
          }
      }
      return a.levels.find((u) => u.ilvl === o) ?? null;
    },
    getAbstract(r) {
      return t.get(r) ?? null;
    },
    hasNumbering(r) {
      return n.has(r);
    },
  };
}
var vo = {
    accent1: 'accent1',
    accent2: 'accent2',
    accent3: 'accent3',
    accent4: 'accent4',
    accent5: 'accent5',
    accent6: 'accent6',
    dk1: 'dk1',
    lt1: 'lt1',
    dk2: 'dk2',
    lt2: 'lt2',
    tx1: 'text1',
    tx2: 'text2',
    bg1: 'background1',
    bg2: 'background2',
    hlink: 'hlink',
    folHlink: 'folHlink',
  },
  vn = {
    black: '000000',
    white: 'FFFFFF',
    red: 'FF0000',
    green: '00FF00',
    blue: '0000FF',
    yellow: 'FFFF00',
    cyan: '00FFFF',
    magenta: 'FF00FF',
  };
function kn(e, t) {
  let n = K(t),
    r = n.find((i) => i.name === 'a:shade');
  if (r) {
    let i = l(r, null, 'val');
    i &&
      (e.themeShade = Math.round((parseInt(i, 10) / 1e5) * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase());
  }
  let o = n.find((i) => i.name === 'a:tint');
  if (o) {
    let i = l(o, null, 'val');
    i &&
      (e.themeTint = Math.round((parseInt(i, 10) / 1e5) * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase());
  }
  return e;
}
function An(e) {
  if (!e) return;
  let t = K(e),
    n = t.find((a) => a.name === 'a:srgbClr');
  if (n) {
    let a = l(n, null, 'val');
    if (a) return kn({ rgb: a }, n);
  }
  let r = t.find((a) => a.name === 'a:schemeClr');
  if (r) {
    let a = l(r, null, 'val');
    if (a) {
      let u = { themeColor: vo[a] ?? 'dk1' };
      return kn(u, r);
    }
  }
  let o = t.find((a) => a.name === 'a:sysClr');
  if (o) return { rgb: l(o, null, 'lastClr') ?? '000000' };
  let i = t.find((a) => a.name === 'a:prstClr');
  if (i) {
    let a = l(i, null, 'val');
    if (a && vn[a]) return { rgb: vn[a] };
  }
}
function Nn(e) {
  if (!e) return;
  let t = K(e);
  if (t.find((r) => r.name === 'a:noFill')) return { type: 'none' };
  let n = t.find((r) => r.name === 'a:solidFill');
  if (n) return { type: 'solid', color: An(n) };
  if (t.find((r) => r.name === 'a:gradFill')) return { type: 'gradient' };
}
function Mn(e) {
  let t = e ? _(e, 'a:ln') : null;
  if (!t) return;
  let n = K(t);
  if (n.find((u) => u.name === 'a:noFill')) return;
  let r = {},
    o = l(t, null, 'w');
  o && (r.width = parseInt(o, 10));
  let i = n.find((u) => u.name === 'a:solidFill');
  i && (r.color = An(i));
  let a = n.find((u) => u.name === 'a:prstDash');
  if (a) {
    let u = l(a, null, 'val');
    u && (r.style = u);
  }
  return r;
}
function ht(e) {
  if (!e) return;
  let t = l(e, null, 'relativeFrom') ?? 'column',
    n = _(e, 'wp:align');
  if (n) {
    let o = ge(n);
    return { relativeTo: t, alignment: o };
  }
  let r = _(e, 'wp:posOffset');
  if (r) {
    let o = ge(r),
      i = parseInt(o, 10);
    return { relativeTo: t, posOffset: isNaN(i) ? 0 : i };
  }
  return { relativeTo: t };
}
function wt(e) {
  if (!e) return;
  let t = l(e, null, 'relativeFrom') ?? 'paragraph',
    n = _(e, 'wp:align');
  if (n) {
    let o = ge(n);
    return { relativeTo: t, alignment: o };
  }
  let r = _(e, 'wp:posOffset');
  if (r) {
    let o = ge(r),
      i = parseInt(o, 10);
    return { relativeTo: t, posOffset: isNaN(i) ? 0 : i };
  }
  return { relativeTo: t };
}
function Pn(e) {
  let t = _(e, 'wp:positionH'),
    n = _(e, 'wp:positionV');
  if (!(!t && !n))
    return {
      horizontal: ht(t) ?? { relativeTo: 'column' },
      vertical: wt(n) ?? { relativeTo: 'paragraph' },
    };
}
var yt = ['wp:wrapNone', 'wp:wrapSquare', 'wp:wrapTight', 'wp:wrapThrough', 'wp:wrapTopAndBottom'];
function bt(e, t, n) {
  if (!e) {
    let E = { type: t ? 'behind' : 'inFront' };
    return (
      n?.distT !== void 0 && (E.distT = n.distT),
      n?.distB !== void 0 && (E.distB = n.distB),
      n?.distL !== void 0 && (E.distL = n.distL),
      n?.distR !== void 0 && (E.distR = n.distR),
      E
    );
  }
  let o = (e.name || '').replace('wp:', ''),
    i;
  switch (o) {
    case 'wrapNone':
      i = t ? 'behind' : 'inFront';
      break;
    case 'wrapSquare':
      i = 'square';
      break;
    case 'wrapTight':
      i = 'tight';
      break;
    case 'wrapThrough':
      i = 'through';
      break;
    case 'wrapTopAndBottom':
      i = 'topAndBottom';
      break;
    default:
      i = 'square';
  }
  let a = { type: i },
    u = l(e, null, 'wrapText');
  u && (a.wrapText = u);
  let d = T(e, null, 'distT') ?? n?.distT,
    p = T(e, null, 'distB') ?? n?.distB,
    h = T(e, null, 'distL') ?? n?.distL,
    w = T(e, null, 'distR') ?? n?.distR;
  return (
    d !== void 0 && (a.distT = d),
    p !== void 0 && (a.distB = p),
    h !== void 0 && (a.distL = h),
    w !== void 0 && (a.distR = w),
    a
  );
}
function Rn(e) {
  let t = K(e),
    n = l(e, null, 'behindDoc') === '1',
    r = t.find((i) => yt.includes(i.name ?? '')),
    o = {
      distT: T(e, null, 'distT') ?? void 0,
      distB: T(e, null, 'distB') ?? void 0,
      distL: T(e, null, 'distL') ?? void 0,
      distR: T(e, null, 'distR') ?? void 0,
    };
  return bt(r ?? null, n, o);
}
function ko(e) {
  if (!e) return {};
  let t = {},
    n = T(e, null, 'lIns'),
    r = T(e, null, 'rIns'),
    o = T(e, null, 'tIns'),
    i = T(e, null, 'bIns');
  return (
    (n !== void 0 || r !== void 0 || o !== void 0 || i !== void 0) &&
      (t.margins = { left: n, right: r, top: o, bottom: i }),
    t
  );
}
function In(e, t, n, r, o, i, a, u) {
  if (!e) return [];
  let d = [],
    p = K(e);
  for (let h of p) {
    let w = h.name || '',
      E = w.indexOf(':'),
      v = E >= 0 ? w.substring(E + 1) : w;
    if (v === 'p') {
      let y = t(h, r, o, i, a);
      d.push(y);
    }
  }
  return d;
}
function je(e) {
  let n = K(e).find((u) => u.name === 'wp:inline' || u.name === 'wp:anchor');
  if (!n) return false;
  let r = _(n, 'a:graphic');
  if (!r) return false;
  let o = _(r, 'a:graphicData');
  if (!o) return false;
  let i = _(o, 'wps:wsp');
  return i ? _(i, 'wps:txbx') !== null : false;
}
function Bn(e) {
  let n = K(e).find((C) => C.name === 'wp:inline' || C.name === 'wp:anchor');
  if (!n) return null;
  let r = n.name === 'wp:anchor',
    o = _(n, 'a:graphic');
  if (!o) return null;
  let i = _(o, 'a:graphicData');
  if (!i) return null;
  let a = _(i, 'wps:wsp');
  if (!a || !_(a, 'wps:txbx')) return null;
  let d = K(a),
    p = d.find((C) => C.name === 'wps:spPr'),
    h = d.find((C) => C.name === 'wps:bodyPr'),
    w = _(n, 'wp:extent'),
    E = T(w, null, 'cx') ?? 0,
    v = T(w, null, 'cy') ?? 0,
    y = { width: E, height: v },
    k = _(n, 'wp:docPr'),
    A = k ? (l(k, null, 'id') ?? void 0) : void 0,
    X = Nn(p ?? null),
    I = Mn(p ?? null),
    M = ko(h ?? null),
    x = { type: 'textBox', size: y, content: [] };
  if (
    (A && (x.id = A),
    X && (x.fill = X),
    I && (x.outline = I),
    M.margins && (x.margins = M.margins),
    r)
  ) {
    let C = Pn(n);
    C && (x.position = C);
    let P = Rn(n);
    P && (x.wrap = P);
  }
  return x;
}
function Dn(e) {
  let t = _(e, 'wps:txbx');
  return t ? _(t, 'w:txbxContent') : null;
}
function Ao(e) {
  if (!e) return;
  let t = parseInt(e, 10);
  if (!isNaN(t)) return t / 6e4;
}
function No(e, t) {
  let n = K(e);
  for (let r of n) if (t.includes(r.name || '')) return r;
  return null;
}
function Ln(e) {
  if (!e) return { width: 0, height: 0 };
  let t = T(e, null, 'cx') ?? 0,
    n = T(e, null, 'cy') ?? 0;
  return { width: t, height: n };
}
function Xn(e) {
  if (!e) return;
  let t = T(e, null, 'l') ?? 0,
    n = T(e, null, 't') ?? 0,
    r = T(e, null, 'r') ?? 0,
    o = T(e, null, 'b') ?? 0;
  if (!(t === 0 && n === 0 && r === 0 && o === 0)) return { left: t, top: n, right: r, bottom: o };
}
function On(e) {
  if (!e) return {};
  let t = l(e, null, 'id') ?? void 0,
    n = l(e, null, 'name') ?? void 0,
    r = l(e, null, 'descr') ?? void 0,
    o = l(e, null, 'title') ?? void 0,
    i = l(e, null, 'decorative') === '1',
    a = f(e, 'a', 'hlinkClick'),
    u = a ? (l(a, 'r', 'id') ?? void 0) : void 0;
  return { id: t, name: n, alt: r, title: o, decorative: i || void 0, hlinkRId: u };
}
function _n(e) {
  if (!e) return;
  let t = l(e, null, 'rot'),
    n = l(e, null, 'flipH') === '1',
    r = l(e, null, 'flipV') === '1',
    o = Ao(t);
  if (o === void 0 && !n && !r) return;
  let i = {};
  return (o !== void 0 && (i.rotation = o), n && (i.flipH = true), r && (i.flipV = true), i);
}
function Hn(e) {
  let t = _(e, 'a:graphic');
  if (!t) return null;
  let n = _(t, 'a:graphicData');
  if (!n) return null;
  let r = _(n, 'pic:pic');
  if (!r) return null;
  let o = _(r, 'pic:blipFill');
  return o ? _(o, 'a:blip') : null;
}
function Vn(e) {
  if (!e) return '';
  let t = l(e, 'r', 'embed');
  if (t) return t;
  let n = l(e, null, 'embed');
  if (n) return n;
  let r = l(e, 'r', 'link');
  return r || '';
}
function jn(e) {
  let t = _(e, 'a:graphic');
  if (!t) return null;
  let n = _(t, 'a:graphicData');
  if (!n) return null;
  let r = _(n, 'pic:pic');
  if (!r) return null;
  let o = _(r, 'pic:spPr');
  return o ? _(o, 'a:xfrm') : null;
}
function Mo(e) {
  if (!e) return e;
  let t = e.replace(/^\/+/, '');
  return (
    t.startsWith('media/') ? (t = `word/${t}`) : t.startsWith('word/') || (t = `word/${t}`),
    t
  );
}
function Po(e) {
  let t = e.split('.').pop()?.toLowerCase() ?? '';
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
      tif: 'image/tiff',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      emf: 'image/x-emf',
      wmf: 'image/x-wmf',
    }[t] ?? 'application/octet-stream'
  );
}
function Un(e, t, n) {
  if (!e || !t) return {};
  let r = t.get(e);
  if (!r) return {};
  let o = r.target;
  if (!o) return {};
  let i = Mo(o),
    a = o.split('/').pop(),
    u = (d, p) => {
      let h = p.toLowerCase();
      for (let [w, E] of d.entries()) if (w.toLowerCase() === h) return E;
    };
  if (n) {
    let d = u(n, i);
    if (d) return { src: d.dataUrl || d.base64, mimeType: d.mimeType, filename: a };
    let p = o.replace(/^\/+/, ''),
      h = u(n, p);
    if (h) return { src: h.dataUrl || h.base64, mimeType: h.mimeType, filename: a };
    let w = `word/${p}`,
      E = u(n, w);
    if (E) return { src: E.dataUrl || E.base64, mimeType: E.mimeType, filename: a };
  }
  return { mimeType: Po(o), filename: a };
}
function Ro(e, t, n) {
  let r = _(e, 'wp:extent'),
    o = Ln(r),
    i = _(e, 'wp:effectExtent'),
    a = Xn(i),
    u = _(e, 'wp:docPr'),
    d = On(u),
    p = Hn(e),
    h = Vn(p),
    w = Un(h, t, n),
    E = jn(e),
    v = _n(E),
    y = T(e, null, 'distT') ?? void 0,
    k = T(e, null, 'distB') ?? void 0,
    A = T(e, null, 'distL') ?? void 0,
    X = T(e, null, 'distR') ?? void 0,
    I = { type: 'inline' };
  (y !== void 0 && (I.distT = y),
    k !== void 0 && (I.distB = k),
    A !== void 0 && (I.distL = A),
    X !== void 0 && (I.distR = X));
  let M = { type: 'image', rId: h, size: o, wrap: I };
  if (
    (d.id && (M.id = d.id),
    d.alt && (M.alt = d.alt),
    d.title && (M.title = d.title),
    d.decorative && (M.decorative = true),
    w.src && (M.src = w.src),
    w.mimeType && (M.mimeType = w.mimeType),
    w.filename && (M.filename = w.filename),
    a && (M.padding = a),
    v && (M.transform = v),
    d.hlinkRId && t)
  ) {
    let x = ct(t, d.hlinkRId);
    x && (M.hlinkHref = x);
  }
  return M;
}
function Io(e, t, n) {
  let r = _(e, 'wp:extent'),
    o = Ln(r),
    i = _(e, 'wp:effectExtent'),
    a = Xn(i),
    u = _(e, 'wp:docPr'),
    d = On(u),
    p = l(e, null, 'behindDoc') === '1',
    h = {
      distT: T(e, null, 'distT') ?? void 0,
      distB: T(e, null, 'distB') ?? void 0,
      distL: T(e, null, 'distL') ?? void 0,
      distR: T(e, null, 'distR') ?? void 0,
    },
    w = No(e, yt),
    E = bt(w, p, h),
    v = _(e, 'wp:positionH'),
    y = _(e, 'wp:positionV'),
    k = ht(v),
    A = wt(y),
    X;
  (k || A) &&
    (X = { horizontal: k ?? { relativeTo: 'column' }, vertical: A ?? { relativeTo: 'paragraph' } });
  let I = Hn(e),
    M = Vn(I),
    x = Un(M, t, n),
    C = jn(e),
    P = _n(C),
    S = { type: 'image', rId: M, size: o, wrap: E };
  if (
    (d.id && (S.id = d.id),
    d.alt && (S.alt = d.alt),
    d.title && (S.title = d.title),
    d.decorative && (S.decorative = true),
    x.src && (S.src = x.src),
    x.mimeType && (S.mimeType = x.mimeType),
    x.filename && (S.filename = x.filename),
    X && (S.position = X),
    a && (S.padding = a),
    P && (S.transform = P),
    d.hlinkRId && t)
  ) {
    let R = ct(t, d.hlinkRId);
    R && (S.hlinkHref = R);
  }
  return S;
}
function Bo(e, t, n) {
  if (je(e)) return null;
  let r = K(e);
  for (let o of r) {
    let i = o.name || '';
    if (i === 'wp:inline' || i === 'wp:anchor')
      return i === 'wp:inline' ? Ro(o, t, n) : Io(o, t, n);
  }
  return null;
}
function Wn(e, t, n) {
  return Bo(e, t, n);
}
function Kn(e, t, n, r) {
  let o = {};
  return (
    e && e !== 'auto' ? (o.rgb = e) : e === 'auto' && (o.auto = true),
    t && (o.themeColor = t),
    n && (o.themeTint = n),
    r && (o.themeShade = r),
    o
  );
}
function Do(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'color');
  n && n !== 'auto' && (t.color = { rgb: n });
  let r = l(e, 'w', 'fill');
  r && r !== 'auto' && (t.fill = { rgb: r });
  let o = l(e, 'w', 'themeFill');
  o && ((t.fill = t.fill || {}), (t.fill.themeColor = o));
  let i = l(e, 'w', 'themeFillTint');
  i && t.fill && (t.fill.themeTint = i);
  let a = l(e, 'w', 'themeFillShade');
  a && t.fill && (t.fill.themeShade = a);
  let u = l(e, 'w', 'val');
  return (u && (t.pattern = u), Object.keys(t).length > 0 ? t : void 0);
}
function Ue(e, t, n) {
  if (!e) return;
  let r = {},
    o = f(e, 'w', 'b');
  o && (r.bold = N(o));
  let i = f(e, 'w', 'bCs');
  i && (r.boldCs = N(i));
  let a = f(e, 'w', 'i');
  a && (r.italic = N(a));
  let u = f(e, 'w', 'iCs');
  u && (r.italicCs = N(u));
  let d = f(e, 'w', 'u');
  if (d) {
    let B = l(d, 'w', 'val');
    if (B) {
      r.underline = { style: B };
      let G = l(d, 'w', 'color'),
        ie = l(d, 'w', 'themeColor');
      (G || ie) && (r.underline.color = Kn(G, ie, l(d, 'w', 'themeTint'), l(d, 'w', 'themeShade')));
    }
  }
  let p = f(e, 'w', 'strike');
  p && (r.strike = N(p));
  let h = f(e, 'w', 'dstrike');
  h && (r.doubleStrike = N(h));
  let w = f(e, 'w', 'vertAlign');
  if (w) {
    let B = l(w, 'w', 'val');
    (B === 'superscript' || B === 'subscript' || B === 'baseline') && (r.vertAlign = B);
  }
  let E = f(e, 'w', 'smallCaps');
  E && (r.smallCaps = N(E));
  let v = f(e, 'w', 'caps');
  v && (r.allCaps = N(v));
  let y = f(e, 'w', 'vanish');
  y && (r.hidden = N(y));
  let k = f(e, 'w', 'color');
  k &&
    (r.color = Kn(
      l(k, 'w', 'val'),
      l(k, 'w', 'themeColor'),
      l(k, 'w', 'themeTint'),
      l(k, 'w', 'themeShade')
    ));
  let A = f(e, 'w', 'highlight');
  if (A) {
    let B = l(A, 'w', 'val');
    B && (r.highlight = B);
  }
  let X = f(e, 'w', 'shd');
  X && (r.shading = Do(X));
  let I = f(e, 'w', 'sz');
  if (I) {
    let B = T(I, 'w', 'val');
    B !== void 0 && (r.fontSize = B);
  }
  let M = f(e, 'w', 'szCs');
  if (M) {
    let B = T(M, 'w', 'val');
    B !== void 0 && (r.fontSizeCs = B);
  }
  let x = f(e, 'w', 'rFonts');
  if (x) {
    r.fontFamily = {
      ascii: l(x, 'w', 'ascii') ?? void 0,
      hAnsi: l(x, 'w', 'hAnsi') ?? void 0,
      eastAsia: l(x, 'w', 'eastAsia') ?? void 0,
      cs: l(x, 'w', 'cs') ?? void 0,
    };
    let B = l(x, 'w', 'asciiTheme');
    B &&
      ((r.fontFamily.asciiTheme = B), t && !r.fontFamily.ascii && (r.fontFamily.ascii = fe(t, B)));
    let G = l(x, 'w', 'hAnsiTheme');
    G &&
      ((r.fontFamily.hAnsiTheme = G), t && !r.fontFamily.hAnsi && (r.fontFamily.hAnsi = fe(t, G)));
    let ie = l(x, 'w', 'eastAsiaTheme');
    ie &&
      ((r.fontFamily.eastAsiaTheme = ie),
      t && !r.fontFamily.eastAsia && (r.fontFamily.eastAsia = fe(t, ie)));
    let z = l(x, 'w', 'cstheme');
    z && ((r.fontFamily.csTheme = z), t && !r.fontFamily.cs && (r.fontFamily.cs = fe(t, z)));
  }
  let C = f(e, 'w', 'spacing');
  if (C) {
    let B = T(C, 'w', 'val');
    B !== void 0 && (r.spacing = B);
  }
  let P = f(e, 'w', 'position');
  if (P) {
    let B = T(P, 'w', 'val');
    B !== void 0 && (r.position = B);
  }
  let S = f(e, 'w', 'w');
  if (S) {
    let B = T(S, 'w', 'val');
    B !== void 0 && (r.scale = B);
  }
  let R = f(e, 'w', 'kern');
  if (R) {
    let B = T(R, 'w', 'val');
    B !== void 0 && (r.kerning = B);
  }
  let m = f(e, 'w', 'effect');
  if (m) {
    let B = l(m, 'w', 'val');
    B && (r.effect = B);
  }
  let O = f(e, 'w', 'em');
  if (O) {
    let B = l(O, 'w', 'val');
    B && (r.emphasisMark = B);
  }
  let W = f(e, 'w', 'emboss');
  W && (r.emboss = N(W));
  let Y = f(e, 'w', 'imprint');
  Y && (r.imprint = N(Y));
  let oe = f(e, 'w', 'outline');
  oe && (r.outline = N(oe));
  let ue = f(e, 'w', 'shadow');
  ue && (r.shadow = N(ue));
  let $ = f(e, 'w', 'rtl');
  $ && (r.rtl = N($));
  let j = f(e, 'w', 'cs');
  j && (r.cs = N(j));
  let D = f(e, 'w', 'rStyle');
  if (D) {
    let B = l(D, 'w', 'val');
    B && (r.styleId = B);
  }
  return Object.keys(r).length > 0 ? r : void 0;
}
function Lo(e) {
  let t = l(e, 'w', 'id'),
    n = t ? parseInt(t, 10) : 0,
    r = (l(e, 'w', 'author') ?? '').trim(),
    o = (l(e, 'w', 'date') ?? '').trim(),
    i = (l(e, 'w', 'rsid') ?? '').trim();
  return {
    id: Number.isInteger(n) && n >= 0 ? n : 0,
    author: r.length > 0 ? r : 'Unknown',
    date: o.length > 0 ? o : void 0,
    rsid: i.length > 0 ? i : void 0,
  };
}
function Xo(e, t, n, r) {
  if (!e) return;
  let o = U(e, 'w', 'rPrChange')
    .map((i) => {
      let a = f(i, 'w', 'rPr');
      return {
        type: 'runPropertyChange',
        info: Lo(i),
        previousFormatting: Ue(a, t),
        currentFormatting: r,
      };
    })
    .filter((i) => i.previousFormatting || i.currentFormatting);
  return o.length > 0 ? o : void 0;
}
function Oo(e) {
  let t = ge(e),
    n = l(e, 'xml', 'space') === 'preserve';
  return { type: 'text', text: t, preserveSpace: n || void 0 };
}
function _o() {
  return { type: 'tab' };
}
function Ho(e) {
  let t = l(e, 'w', 'type'),
    n = l(e, 'w', 'clear'),
    r = { type: 'break' };
  return (
    (t === 'page' || t === 'column' || t === 'textWrapping') && (r.breakType = t),
    (n === 'none' || n === 'left' || n === 'right' || n === 'all') && (r.clear = n),
    r
  );
}
function Vo(e) {
  let t = l(e, 'w', 'font') ?? '',
    n = l(e, 'w', 'char') ?? '';
  return { type: 'symbol', font: t, char: n };
}
function jo(e) {
  return { type: 'footnoteRef', id: T(e, 'w', 'id') ?? 0 };
}
function Uo(e) {
  return { type: 'endnoteRef', id: T(e, 'w', 'id') ?? 0 };
}
function Wo(e) {
  let t = l(e, 'w', 'fldCharType'),
    n = l(e, 'w', 'fldLock') === 'true' || l(e, 'w', 'fldLock') === '1',
    r = l(e, 'w', 'dirty') === 'true' || l(e, 'w', 'dirty') === '1',
    o = 'begin';
  return (
    t === 'separate' ? (o = 'separate') : t === 'end' && (o = 'end'),
    { type: 'fieldChar', charType: o, fldLock: n || void 0, dirty: r || void 0 }
  );
}
function Ko(e) {
  return { type: 'instrText', text: ge(e) };
}
function zo(e, t, n) {
  let r = Wn(e, t ?? void 0, n ?? void 0);
  return r ? { type: 'drawing', image: r } : null;
}
function Go(e) {
  if (!e) return '';
  let t = e.indexOf(':');
  return t >= 0 ? e.substring(t + 1) : e;
}
function qo(e, t, n) {
  let r = [],
    o = K(e);
  for (let i of o)
    switch (Go(i.name)) {
      case 't':
        r.push(Oo(i));
        break;
      case 'tab':
        r.push(_o());
        break;
      case 'br':
        r.push(Ho(i));
        break;
      case 'sym':
        r.push(Vo(i));
        break;
      case 'footnoteReference':
        r.push(jo(i));
        break;
      case 'endnoteReference':
        r.push(Uo(i));
        break;
      case 'fldChar':
        r.push(Wo(i));
        break;
      case 'instrText':
        r.push(Ko(i));
        break;
      case 'softHyphen':
        r.push({ type: 'softHyphen' });
        break;
      case 'noBreakHyphen':
        r.push({ type: 'noBreakHyphen' });
        break;
      case 'drawing':
        let u = zo(i, t, n);
        u && r.push(u);
        break;
      case 'pict':
      case 'object':
        break;
      case 'rPr':
        break;
      case 'lastRenderedPageBreak':
        break;
      case 'cr':
        r.push({ type: 'break', breakType: 'textWrapping' });
        break;
    }
  return r;
}
function Ae(e, t, n, r = null, o = null) {
  let i = { type: 'run', content: [] },
    a = f(e, 'w', 'rPr');
  return (
    a && ((i.formatting = Ue(a, n)), (i.propertyChanges = Xo(a, n, t, i.formatting))),
    (i.content = qo(e, r, o)),
    i
  );
}
function $o(e) {
  if (!e) return '';
  let t = e.indexOf(':');
  return t >= 0 ? e.substring(t + 1) : e;
}
function Yo(e) {
  let t = T(e, 'w', 'id') ?? 0,
    n = l(e, 'w', 'name') ?? '',
    r = { type: 'bookmarkStart', id: t, name: n },
    o = T(e, 'w', 'colFirst');
  o !== void 0 && (r.colFirst = o);
  let i = T(e, 'w', 'colLast');
  return (i !== void 0 && (r.colLast = i), r);
}
function Zo(e) {
  return { type: 'bookmarkEnd', id: T(e, 'w', 'id') ?? 0 };
}
function zn(e, t, n = null, r = null, o = null) {
  let i = { type: 'hyperlink', children: [] },
    a = l(e, 'r', 'id');
  if (a && ((i.rId = a), t)) {
    let v = t.get(a);
    v && (fn(v), (i.href = v.target));
  }
  let u = l(e, 'w', 'anchor');
  u && ((i.anchor = u), i.href || (i.href = `#${u}`));
  let d = l(e, 'w', 'tooltip');
  d && (i.tooltip = d);
  let p = l(e, 'w', 'tgtFrame');
  p && (i.target = p);
  let h = l(e, 'w', 'history');
  (h === '1' || h === 'true') && (i.history = true);
  let w = l(e, 'w', 'docLocation');
  w && (i.docLocation = w);
  let E = K(e);
  for (let v of E)
    switch ($o(v.name)) {
      case 'r':
        i.children.push(Ae(v, n, r, t, o));
        break;
      case 'bookmarkStart':
        i.children.push(Yo(v));
        break;
      case 'bookmarkEnd':
        i.children.push(Zo(v));
        break;
    }
  return i;
}
function Gn(e) {
  let t = T(e, 'w', 'id') ?? 0,
    n = l(e, 'w', 'name') ?? '',
    r = { type: 'bookmarkStart', id: t, name: n },
    o = T(e, 'w', 'colFirst');
  o !== void 0 && (r.colFirst = o);
  let i = T(e, 'w', 'colLast');
  return (i !== void 0 && (r.colLast = i), r);
}
function qn(e) {
  return { type: 'bookmarkEnd', id: T(e, 'w', 'id') ?? 0 };
}
function Qo(e) {
  if (!e) return;
  let t = T(e, 'w', 'w') ?? 0,
    n = l(e, 'w', 'type') ?? 'dxa',
    r = 'dxa';
  return (
    (n === 'auto' || n === 'dxa' || n === 'nil' || n === 'pct') && (r = n),
    { value: t, type: r }
  );
}
function we(e) {
  return Qo(e);
}
function Ce(e) {
  let t = l(e, 'w', 'id'),
    n = t ? parseInt(t, 10) : 0,
    r = (l(e, 'w', 'author') ?? '').trim(),
    o = (l(e, 'w', 'date') ?? '').trim();
  return {
    id: Number.isInteger(n) && n >= 0 ? n : 0,
    author: r.length > 0 ? r : 'Unknown',
    date: o.length > 0 ? o : void 0,
  };
}
function xt(e) {
  let t = Ce(e),
    n = (l(e, 'w', 'rsid') ?? '').trim();
  return n.length > 0 ? { ...t, rsid: n } : t;
}
function Ee(e) {
  if (!e) return;
  let r = { style: l(e, 'w', 'val') ?? 'none' },
    o = T(e, 'w', 'sz');
  o !== void 0 && (r.size = o);
  let i = T(e, 'w', 'space');
  i !== void 0 && (r.space = i);
  let a = l(e, 'w', 'color'),
    u = l(e, 'w', 'themeColor'),
    d = l(e, 'w', 'themeTint'),
    p = l(e, 'w', 'themeShade');
  (a || u || d || p) &&
    (r.color = {
      rgb: a ?? void 0,
      themeColor: u,
      themeTint: d ?? void 0,
      themeShade: p ?? void 0,
    });
  let h = l(e, 'w', 'shadow');
  (h === '1' || h === 'true') && (r.shadow = true);
  let w = l(e, 'w', 'frame');
  return ((w === '1' || w === 'true') && (r.frame = true), r);
}
function $n(e) {
  if (!e) return;
  let t = {},
    n = Ee(f(e, 'w', 'top'));
  n && (t.top = n);
  let r = Ee(f(e, 'w', 'bottom'));
  r && (t.bottom = r);
  let o = Ee(f(e, 'w', 'left') ?? f(e, 'w', 'start'));
  o && (t.left = o);
  let i = Ee(f(e, 'w', 'right') ?? f(e, 'w', 'end'));
  i && (t.right = i);
  let a = Ee(f(e, 'w', 'insideH'));
  a && (t.insideH = a);
  let u = Ee(f(e, 'w', 'insideV'));
  if ((u && (t.insideV = u), Object.keys(t).length !== 0)) return t;
}
function Yn(e) {
  if (!e) return;
  let t = {},
    n = we(f(e, 'w', 'top'));
  n && (t.top = n);
  let r = we(f(e, 'w', 'bottom'));
  r && (t.bottom = r);
  let o = we(f(e, 'w', 'left') ?? f(e, 'w', 'start'));
  o && (t.left = o);
  let i = we(f(e, 'w', 'right') ?? f(e, 'w', 'end'));
  if ((i && (t.right = i), Object.keys(t).length !== 0)) return t;
}
function Zn(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'fill');
  n && n !== 'auto' && (t.fill = { rgb: n });
  let r = l(e, 'w', 'themeFill');
  if (r) {
    t.fill = { themeColor: r };
    let a = l(e, 'w', 'themeFillTint');
    a && t.fill && (t.fill.themeTint = a);
    let u = l(e, 'w', 'themeFillShade');
    u && t.fill && (t.fill.themeShade = u);
  }
  let o = l(e, 'w', 'color');
  o && o !== 'auto' && (t.color = { rgb: o });
  let i = l(e, 'w', 'val');
  if ((i && (t.pattern = i), Object.keys(t).length !== 0)) return t;
}
function Jo(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'firstRow');
  (n === '1' || n === 'true') && (t.firstRow = true);
  let r = l(e, 'w', 'lastRow');
  (r === '1' || r === 'true') && (t.lastRow = true);
  let o = l(e, 'w', 'firstColumn');
  (o === '1' || o === 'true') && (t.firstColumn = true);
  let i = l(e, 'w', 'lastColumn');
  (i === '1' || i === 'true') && (t.lastColumn = true);
  let a = l(e, 'w', 'noHBand');
  (a === '1' || a === 'true') && (t.noHBand = true);
  let u = l(e, 'w', 'noVBand');
  (u === '1' || u === 'true') && (t.noVBand = true);
  let d = l(e, 'w', 'val');
  if (d) {
    let p = parseInt(d, 16);
    isNaN(p) ||
      (p & 32 && (t.firstRow = true),
      p & 64 && (t.lastRow = true),
      p & 128 && (t.firstColumn = true),
      p & 256 && (t.lastColumn = true),
      p & 512 && (t.noHBand = true),
      p & 1024 && (t.noVBand = true));
  }
  if (Object.keys(t).length !== 0) return t;
}
function ei(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'horzAnchor');
  (n === 'margin' || n === 'page' || n === 'text') && (t.horzAnchor = n);
  let r = l(e, 'w', 'vertAnchor');
  (r === 'margin' || r === 'page' || r === 'text') && (t.vertAnchor = r);
  let o = T(e, 'w', 'tblpX');
  o !== void 0 && (t.tblpX = o);
  let i = l(e, 'w', 'tblpXSpec');
  i && (t.tblpXSpec = i);
  let a = T(e, 'w', 'tblpY');
  a !== void 0 && (t.tblpY = a);
  let u = l(e, 'w', 'tblpYSpec');
  u && (t.tblpYSpec = u);
  let d = T(e, 'w', 'topFromText');
  d !== void 0 && (t.topFromText = d);
  let p = T(e, 'w', 'bottomFromText');
  p !== void 0 && (t.bottomFromText = p);
  let h = T(e, 'w', 'leftFromText');
  h !== void 0 && (t.leftFromText = h);
  let w = T(e, 'w', 'rightFromText');
  if ((w !== void 0 && (t.rightFromText = w), Object.keys(t).length !== 0)) return t;
}
function Qn(e) {
  if (!e) return;
  let t = {},
    n = we(f(e, 'w', 'tblW'));
  n && (t.width = n);
  let r = f(e, 'w', 'jc');
  if (r) {
    let k = l(r, 'w', 'val');
    (k === 'left' || k === 'center' || k === 'right' || k === 'start') &&
      (t.justification = k === 'start' ? 'left' : k);
  }
  let o = we(f(e, 'w', 'tblCellSpacing'));
  o && (t.cellSpacing = o);
  let i = we(f(e, 'w', 'tblInd'));
  i && (t.indent = i);
  let a = $n(f(e, 'w', 'tblBorders'));
  a && (t.borders = a);
  let u = Yn(f(e, 'w', 'tblCellMar'));
  u && (t.cellMargins = u);
  let d = f(e, 'w', 'tblLayout');
  if (d) {
    let k = l(d, 'w', 'type');
    (k === 'fixed' || k === 'autofit') && (t.layout = k);
  }
  let p = f(e, 'w', 'tblStyle');
  if (p) {
    let k = l(p, 'w', 'val');
    k && (t.styleId = k);
  }
  let h = Jo(f(e, 'w', 'tblLook'));
  h && (t.look = h);
  let w = Zn(f(e, 'w', 'shd'));
  w && (t.shading = w);
  let E = f(e, 'w', 'tblOverlap');
  if (E) {
    let k = l(E, 'w', 'val');
    (k === 'never' || k === 'overlap') && (t.overlap = k);
  }
  let v = ei(f(e, 'w', 'tblpPr'));
  if (
    (v && (t.floating = v),
    N(f(e, 'w', 'bidiVisual')) && (t.bidi = true),
    Object.keys(t).length !== 0)
  )
    return t;
}
function ti(e, t) {
  if (!e) return;
  let n = U(e, 'w', 'tblPrChange')
    .map((r) => {
      let o = f(r, 'w', 'tblPr');
      return {
        type: 'tablePropertyChange',
        info: xt(r),
        previousFormatting: Qn(o),
        currentFormatting: t,
      };
    })
    .filter((r) => r.previousFormatting || r.currentFormatting);
  return n.length > 0 ? n : void 0;
}
function ni(e, t) {
  if (!e) return;
  let n = U(e, 'w', 'trPrChange')
    .map((r) => {
      let o = f(r, 'w', 'trPr');
      return {
        type: 'tableRowPropertyChange',
        info: xt(r),
        previousFormatting: Jn(o),
        currentFormatting: t,
      };
    })
    .filter((r) => r.previousFormatting || r.currentFormatting);
  return n.length > 0 ? n : void 0;
}
function ri(e, t) {
  if (!e) return;
  let n = U(e, 'w', 'tcPrChange')
    .map((r) => {
      let o = f(r, 'w', 'tcPr');
      return {
        type: 'tableCellPropertyChange',
        info: xt(r),
        previousFormatting: tr(o),
        currentFormatting: t,
      };
    })
    .filter((r) => r.previousFormatting || r.currentFormatting);
  return n.length > 0 ? n : void 0;
}
function oi(e) {
  if (!e) return;
  let t = f(e, 'w', 'ins');
  if (t) return { type: 'tableRowInsertion', info: Ce(t) };
  let n = f(e, 'w', 'del');
  if (n) return { type: 'tableRowDeletion', info: Ce(n) };
}
function ii(e) {
  if (!e) return;
  let t = f(e, 'w', 'cellIns');
  if (t) return { type: 'tableCellInsertion', info: Ce(t) };
  let n = f(e, 'w', 'cellDel');
  if (n) return { type: 'tableCellDeletion', info: Ce(n) };
  let r = f(e, 'w', 'cellMerge');
  if (r) return { type: 'tableCellMerge', info: Ce(r) };
}
function Jn(e) {
  if (!e) return;
  let t = {},
    n = f(e, 'w', 'trHeight');
  if (n) {
    let d = we(n);
    d && (t.height = d);
    let p = l(n, 'w', 'hRule');
    (p === 'auto' || p === 'atLeast' || p === 'exact') && (t.heightRule = p);
  }
  (N(f(e, 'w', 'tblHeader')) && (t.header = true),
    N(f(e, 'w', 'cantSplit')) && (t.cantSplit = true));
  let i = f(e, 'w', 'jc');
  if (i) {
    let d = l(i, 'w', 'val');
    (d === 'left' || d === 'center' || d === 'right') && (t.justification = d);
  }
  N(f(e, 'w', 'hidden')) && (t.hidden = true);
  let u = er(f(e, 'w', 'cnfStyle'));
  if ((u && (t.conditionalFormat = u), Object.keys(t).length !== 0)) return t;
}
function er(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'firstRow');
  (n === '1' || n === 'true') && (t.firstRow = true);
  let r = l(e, 'w', 'lastRow');
  (r === '1' || r === 'true') && (t.lastRow = true);
  let o = l(e, 'w', 'firstColumn');
  (o === '1' || o === 'true') && (t.firstColumn = true);
  let i = l(e, 'w', 'lastColumn');
  (i === '1' || i === 'true') && (t.lastColumn = true);
  let a = l(e, 'w', 'oddHBand');
  (a === '1' || a === 'true') && (t.oddHBand = true);
  let u = l(e, 'w', 'evenHBand');
  (u === '1' || u === 'true') && (t.evenHBand = true);
  let d = l(e, 'w', 'oddVBand');
  (d === '1' || d === 'true') && (t.oddVBand = true);
  let p = l(e, 'w', 'evenVBand');
  (p === '1' || p === 'true') && (t.evenVBand = true);
  let h = l(e, 'w', 'firstRowFirstColumn');
  (h === '1' || h === 'true') && (t.nwCell = true);
  let w = l(e, 'w', 'firstRowLastColumn');
  (w === '1' || w === 'true') && (t.neCell = true);
  let E = l(e, 'w', 'lastRowFirstColumn');
  (E === '1' || E === 'true') && (t.swCell = true);
  let v = l(e, 'w', 'lastRowLastColumn');
  (v === '1' || v === 'true') && (t.seCell = true);
  let y = l(e, 'w', 'val');
  if (
    (y &&
      y.length === 12 &&
      (y[0] === '1' && (t.firstRow = true),
      y[1] === '1' && (t.lastRow = true),
      y[2] === '1' && (t.firstColumn = true),
      y[3] === '1' && (t.lastColumn = true),
      y[4] === '1' && (t.oddVBand = true),
      y[5] === '1' && (t.evenVBand = true),
      y[6] === '1' && (t.oddHBand = true),
      y[7] === '1' && (t.evenHBand = true),
      y[8] === '1' && (t.nwCell = true),
      y[9] === '1' && (t.neCell = true),
      y[10] === '1' && (t.swCell = true),
      y[11] === '1' && (t.seCell = true)),
    Object.keys(t).length !== 0)
  )
    return t;
}
function tr(e) {
  if (!e) return;
  let t = {},
    n = we(f(e, 'w', 'tcW'));
  n && (t.width = n);
  let r = $n(f(e, 'w', 'tcBorders'));
  r && (t.borders = r);
  let o = Yn(f(e, 'w', 'tcMar'));
  o && (t.margins = o);
  let i = Zn(f(e, 'w', 'shd'));
  i && (t.shading = i);
  let a = f(e, 'w', 'vAlign');
  if (a) {
    let y = l(a, 'w', 'val');
    (y === 'top' || y === 'center' || y === 'bottom') && (t.verticalAlign = y);
  }
  let u = f(e, 'w', 'textDirection');
  if (u) {
    let y = l(u, 'w', 'val');
    y && (t.textDirection = y);
  }
  let d = f(e, 'w', 'gridSpan');
  if (d) {
    let y = T(d, 'w', 'val');
    y !== void 0 && y > 1 && (t.gridSpan = y);
  }
  let p = f(e, 'w', 'vMerge');
  (p && (l(p, 'w', 'val') === 'restart' ? (t.vMerge = 'restart') : (t.vMerge = 'continue')),
    N(f(e, 'w', 'tcFitText')) && (t.fitText = true),
    N(f(e, 'w', 'noWrap')) && (t.noWrap = true),
    N(f(e, 'w', 'hideMark')) && (t.hideMark = true));
  let v = er(f(e, 'w', 'cnfStyle'));
  if ((v && (t.conditionalFormat = v), Object.keys(t).length !== 0)) return t;
}
function ai(e, t, n, r, o, i) {
  let a = [],
    u = e.elements || [];
  for (let d of u) {
    if (!d.name) continue;
    let p = d.name.split(':').pop();
    if (p === 'p') {
      let h = le(d, t, n, r, o, i);
      a.push(h);
    } else if (p === 'tbl') {
      let h = Ne(d, t, n, r, o, i);
      a.push(h);
    }
  }
  return (a.length === 0 && a.push({ type: 'paragraph', content: [] }), a);
}
function si(e, t, n, r, o, i) {
  let a = { type: 'tableCell', content: [] },
    u = f(e, 'w', 'tcPr'),
    d = tr(u);
  return (
    d && (a.formatting = d),
    (a.propertyChanges = ri(u, d)),
    (a.structuralChange = ii(u)),
    (a.content = ai(e, t, n, r, o, i)),
    a
  );
}
function li(e, t, n, r, o, i) {
  let a = { type: 'tableRow', cells: [] },
    u = f(e, 'w', 'trPr'),
    d = Jn(u);
  (d && (a.formatting = d), (a.propertyChanges = ni(u, d)), (a.structuralChange = oi(u)));
  let p = U(e, 'w', 'tc');
  for (let h of p) {
    let w = si(h, t, n, r, o, i);
    a.cells.push(w);
  }
  return a;
}
function ui(e) {
  if (!e) return;
  let t = [],
    n = U(e, 'w', 'gridCol');
  for (let r of n) {
    let o = T(r, 'w', 'w') ?? 0;
    t.push(o);
  }
  return t.length > 0 ? t : void 0;
}
function Ne(e, t, n, r, o, i) {
  let a = { type: 'table', rows: [] },
    u = f(e, 'w', 'tblPr'),
    d = Qn(u);
  (d && (a.formatting = d), (a.propertyChanges = ti(u, d)));
  let p = ui(f(e, 'w', 'tblGrid'));
  p && (a.columnWidths = p);
  let h = U(e, 'w', 'tr');
  for (let w of h) {
    let E = li(w, t, n, r, o, i);
    a.rows.push(E);
  }
  return a;
}
function nr(e) {
  switch (e) {
    case 'first':
      return 'first';
    case 'even':
      return 'even';
    default:
      return 'default';
  }
}
function rr(e) {
  let t = l(e, 'w', 'type'),
    n = l(e, 'r', 'id') ?? '';
  return { type: nr(t), rId: n };
}
function or(e) {
  let t = l(e, 'w', 'type'),
    n = l(e, 'r', 'id') ?? '';
  return { type: nr(t), rId: n };
}
function Ft(e, t, n, r, o, i) {
  let a = [],
    u = e.elements ?? [];
  for (let d of u) {
    if (d.type !== 'element') continue;
    let p = d.name ?? '';
    if (p === 'w:p' || p.endsWith(':p')) {
      let h = le(d, t, n, r, o, i);
      a.push(h);
    } else if (p === 'w:tbl' || p.endsWith(':tbl')) {
      let h = Ne(d, t, n, r, o, i);
      a.push(h);
    } else if (p === 'w:sdt' || p.endsWith(':sdt')) {
      let h = (d.elements ?? []).find(
        (w) =>
          w.type === 'element' && (w.name === 'w:sdtContent' || w.name?.endsWith(':sdtContent'))
      );
      if (h) {
        let w = Ft(h, t, n, r, o, i);
        a.push(...w);
      }
    }
  }
  return a;
}
function ir(e, t = 'default', n = null, r = null, o = null, i = null, a = null) {
  let u = { type: 'header', hdrFtrType: t, content: [] };
  if (!e) return u;
  let d = ae(e);
  if (!d) return u;
  let p = d.elements?.find(
    (h) => h.type === 'element' && (h.name === 'w:hdr' || h.name?.endsWith(':hdr'))
  );
  return (p && (u.content = Ft(p, n, r, o, i, a)), u);
}
function ar(e, t = 'default', n = null, r = null, o = null, i = null, a = null) {
  let u = { type: 'footer', hdrFtrType: t, content: [] };
  if (!e) return u;
  let d = ae(e);
  if (!d) return u;
  let p = d.elements?.find(
    (h) => h.type === 'element' && (h.name === 'w:ftr' || h.name?.endsWith(':ftr'))
  );
  return (p && (u.content = Ft(p, n, r, o, i, a)), u);
}
function sr(e) {
  switch (e) {
    case 'separator':
      return 'separator';
    case 'continuationSeparator':
      return 'continuationSeparator';
    case 'continuationNotice':
      return 'continuationNotice';
    default:
      return 'normal';
  }
}
function ci(e, t, n, r, o, i) {
  let a = T(e, 'w', 'id') ?? 0,
    u = l(e, 'w', 'type'),
    d = sr(u),
    h = U(e, 'w', 'p').map((w) => le(w, t, n, r, o));
  return { type: 'footnote', id: a, noteType: d, content: h };
}
function lr(e, t = null, n = null, r = null, o = null, i = null) {
  let a = new Map(),
    u = [];
  if (!e) return We(a, u);
  let d = ae(e);
  if (!d) return We(a, u);
  let p = d.elements?.find(
    (w) => w.type === 'element' && (w.name === 'w:footnotes' || w.name?.endsWith(':footnotes'))
  );
  if (!p) return We(a, u);
  let h = U(p, 'w', 'footnote');
  for (let w of h) {
    let E = ci(w, t, n, r, o);
    (a.set(E.id, E), u.push(E));
  }
  return We(a, u);
}
function We(e, t) {
  return {
    byId: e,
    footnotes: t,
    getFootnote(n) {
      return e.get(n);
    },
    hasFootnote(n) {
      return e.has(n);
    },
    getNormalFootnotes() {
      return t.filter((n) => n.noteType === 'normal');
    },
    getSeparator() {
      return t.find((n) => n.noteType === 'separator');
    },
    getContinuationSeparator() {
      return t.find((n) => n.noteType === 'continuationSeparator');
    },
  };
}
function fi(e, t, n, r, o, i) {
  let a = T(e, 'w', 'id') ?? 0,
    u = l(e, 'w', 'type'),
    d = sr(u),
    h = U(e, 'w', 'p').map((w) => le(w, t, n, r, o));
  return { type: 'endnote', id: a, noteType: d, content: h };
}
function ur(e, t = null, n = null, r = null, o = null, i = null) {
  let a = new Map(),
    u = [];
  if (!e) return Ke(a, u);
  let d = ae(e);
  if (!d) return Ke(a, u);
  let p = d.elements?.find(
    (w) => w.type === 'element' && (w.name === 'w:endnotes' || w.name?.endsWith(':endnotes'))
  );
  if (!p) return Ke(a, u);
  let h = U(p, 'w', 'endnote');
  for (let w of h) {
    let E = fi(w, t, n, r, o);
    (a.set(E.id, E), u.push(E));
  }
  return Ke(a, u);
}
function Ke(e, t) {
  return {
    byId: e,
    endnotes: t,
    getEndnote(n) {
      return e.get(n);
    },
    hasEndnote(n) {
      return e.has(n);
    },
    getNormalEndnotes() {
      return t.filter((n) => n.noteType === 'normal');
    },
    getSeparator() {
      return t.find((n) => n.noteType === 'separator');
    },
    getContinuationSeparator() {
      return t.find((n) => n.noteType === 'continuationSeparator');
    },
  };
}
function cr(e) {
  return e
    ? {
        decimal: 'decimal',
        upperRoman: 'upperRoman',
        lowerRoman: 'lowerRoman',
        upperLetter: 'upperLetter',
        lowerLetter: 'lowerLetter',
        ordinal: 'ordinal',
        cardinalText: 'cardinalText',
        ordinalText: 'ordinalText',
        bullet: 'bullet',
        chicago: 'chicago',
        none: 'none',
      }[e]
    : void 0;
}
function di(e) {
  switch (e) {
    case 'pageBottom':
      return 'pageBottom';
    case 'beneathText':
      return 'beneathText';
    case 'sectEnd':
      return 'sectEnd';
    case 'docEnd':
      return 'docEnd';
    default:
      return;
  }
}
function mi(e) {
  switch (e) {
    case 'sectEnd':
      return 'sectEnd';
    case 'docEnd':
      return 'docEnd';
    default:
      return;
  }
}
function fr(e) {
  switch (e) {
    case 'continuous':
      return 'continuous';
    case 'eachSect':
      return 'eachSect';
    case 'eachPage':
      return 'eachPage';
    default:
      return;
  }
}
function dr(e) {
  let t = {};
  if (!e) return t;
  let n = f(e, 'w', 'pos');
  if (n) {
    let a = l(n, 'w', 'val');
    t.position = di(a);
  }
  let r = f(e, 'w', 'numFmt');
  if (r) {
    let a = l(r, 'w', 'val');
    t.numFmt = cr(a);
  }
  let o = f(e, 'w', 'numStart');
  o && (t.numStart = T(o, 'w', 'val') ?? void 0);
  let i = f(e, 'w', 'numRestart');
  if (i) {
    let a = l(i, 'w', 'val');
    t.numRestart = fr(a);
  }
  return t;
}
function mr(e) {
  let t = {};
  if (!e) return t;
  let n = f(e, 'w', 'pos');
  if (n) {
    let a = l(n, 'w', 'val');
    t.position = mi(a);
  }
  let r = f(e, 'w', 'numFmt');
  if (r) {
    let a = l(r, 'w', 'val');
    t.numFmt = cr(a);
  }
  let o = f(e, 'w', 'numStart');
  o && (t.numStart = T(o, 'w', 'val') ?? void 0);
  let i = f(e, 'w', 'numRestart');
  if (i) {
    let a = l(i, 'w', 'val');
    t.numRestart = fr(a);
  }
  return t;
}
function os(e) {
  let t = [];
  for (let n of e.content) {
    let r = [];
    for (let o of n.content)
      if (o.type === 'run') for (let i of o.content) i.type === 'text' && r.push(i.text);
    t.push(r.join(''));
  }
  return t.join(`
`);
}
function pi(e, t, n, r) {
  if (!e && !t) return;
  let o = {};
  return (
    e && e !== 'auto' ? (o.rgb = e) : e === 'auto' && (o.auto = true),
    t && (o.themeColor = t),
    n && (o.themeTint = n),
    r && (o.themeShade = r),
    Object.keys(o).length > 0 ? o : void 0
  );
}
function ze(e) {
  if (!e) return;
  let r = { style: l(e, 'w', 'val') ?? 'none' },
    o = T(e, 'w', 'sz');
  o !== void 0 && (r.size = o);
  let i = T(e, 'w', 'space');
  i !== void 0 && (r.space = i);
  let a = l(e, 'w', 'color'),
    u = l(e, 'w', 'themeColor'),
    d = l(e, 'w', 'themeTint'),
    p = l(e, 'w', 'themeShade'),
    h = pi(a, u, d, p);
  h && (r.color = h);
  let w = l(e, 'w', 'shadow');
  (w === '1' || w === 'true') && (r.shadow = true);
  let E = l(e, 'w', 'frame');
  return ((E === '1' || E === 'true') && (r.frame = true), r);
}
function gi(e) {
  switch (e) {
    case 'landscape':
      return 'landscape';
    case 'portrait':
      return 'portrait';
    default:
      return;
  }
}
function hi(e) {
  switch (e) {
    case 'continuous':
      return 'continuous';
    case 'nextPage':
      return 'nextPage';
    case 'oddPage':
      return 'oddPage';
    case 'evenPage':
      return 'evenPage';
    case 'nextColumn':
      return 'nextColumn';
    default:
      return;
  }
}
function wi(e) {
  switch (e) {
    case 'top':
      return 'top';
    case 'center':
      return 'center';
    case 'both':
      return 'both';
    case 'bottom':
      return 'bottom';
    default:
      return;
  }
}
function yi(e) {
  switch (e) {
    case 'continuous':
      return 'continuous';
    case 'newPage':
      return 'newPage';
    case 'newSection':
      return 'newSection';
    default:
      return;
  }
}
function Ge(e, t) {
  let n = {};
  if (!e) return n;
  let r = f(e, 'w', 'pgSz');
  if (r) {
    let x = T(r, 'w', 'w');
    x !== void 0 && (n.pageWidth = x);
    let C = T(r, 'w', 'h');
    C !== void 0 && (n.pageHeight = C);
    let P = l(r, 'w', 'orient'),
      S = gi(P);
    S && (n.orientation = S);
  }
  let o = f(e, 'w', 'pgMar');
  if (o) {
    let x = T(o, 'w', 'top');
    x !== void 0 && (n.marginTop = x);
    let C = T(o, 'w', 'bottom');
    C !== void 0 && (n.marginBottom = C);
    let P = T(o, 'w', 'left');
    P !== void 0 && (n.marginLeft = P);
    let S = T(o, 'w', 'right');
    S !== void 0 && (n.marginRight = S);
    let R = T(o, 'w', 'header');
    R !== void 0 && (n.headerDistance = R);
    let m = T(o, 'w', 'footer');
    m !== void 0 && (n.footerDistance = m);
    let O = T(o, 'w', 'gutter');
    O !== void 0 && (n.gutter = O);
  }
  let i = f(e, 'w', 'cols');
  if (i) {
    let x = T(i, 'w', 'num');
    x !== void 0 && (n.columnCount = x);
    let C = T(i, 'w', 'space');
    C !== void 0 && (n.columnSpace = C);
    let P = l(i, 'w', 'equalWidth');
    P === '1' || P === 'true'
      ? (n.equalWidth = true)
      : (P === '0' || P === 'false') && (n.equalWidth = false);
    let S = l(i, 'w', 'sep');
    (S === '1' || S === 'true') && (n.separator = true);
    let R = U(i, 'w', 'col');
    if (R.length > 0) {
      n.columns = [];
      for (let m of R) {
        let O = {},
          W = T(m, 'w', 'w');
        W !== void 0 && (O.width = W);
        let Y = T(m, 'w', 'space');
        (Y !== void 0 && (O.space = Y), n.columns.push(O));
      }
      n.columnCount === void 0 && (n.columnCount = R.length);
    }
  }
  let a = f(e, 'w', 'type');
  if (a) {
    let x = l(a, 'w', 'val'),
      C = hi(x);
    C && (n.sectionStart = C);
  }
  let u = f(e, 'w', 'vAlign');
  if (u) {
    let x = l(u, 'w', 'val'),
      C = wi(x);
    C && (n.verticalAlign = C);
  }
  let d = f(e, 'w', 'bidi');
  d && (n.bidi = N(d));
  let p = U(e, 'w', 'headerReference');
  p.length > 0 && (n.headerReferences = p.map((x) => rr(x)));
  let h = U(e, 'w', 'footerReference');
  h.length > 0 && (n.footerReferences = h.map((x) => or(x)));
  let w = f(e, 'w', 'titlePg');
  w && (n.titlePg = N(w));
  let E = f(e, 'w', 'evenAndOddHeaders');
  E && (n.evenAndOddHeaders = N(E));
  let v = f(e, 'w', 'lnNumType');
  if (v) {
    n.lineNumbers = {};
    let x = T(v, 'w', 'start');
    x !== void 0 && (n.lineNumbers.start = x);
    let C = T(v, 'w', 'countBy');
    C !== void 0 && (n.lineNumbers.countBy = C);
    let P = T(v, 'w', 'distance');
    P !== void 0 && (n.lineNumbers.distance = P);
    let S = l(v, 'w', 'restart'),
      R = yi(S);
    R && (n.lineNumbers.restart = R);
  }
  let y = f(e, 'w', 'pgBorders');
  if (y) {
    n.pageBorders = {};
    let x = ze(f(y, 'w', 'top'));
    x && (n.pageBorders.top = x);
    let C = ze(f(y, 'w', 'bottom'));
    C && (n.pageBorders.bottom = C);
    let P = ze(f(y, 'w', 'left'));
    P && (n.pageBorders.left = P);
    let S = ze(f(y, 'w', 'right'));
    S && (n.pageBorders.right = S);
    let R = l(y, 'w', 'display');
    (R === 'allPages' || R === 'firstPage' || R === 'notFirstPage') && (n.pageBorders.display = R);
    let m = l(y, 'w', 'offsetFrom');
    (m === 'page' || m === 'text') && (n.pageBorders.offsetFrom = m);
    let O = l(y, 'w', 'zOrder');
    (O === 'front' || O === 'back') && (n.pageBorders.zOrder = O);
  }
  let k = f(e, 'w', 'background');
  if (k) {
    n.background = {};
    let x = l(k, 'w', 'color');
    x && x !== 'auto' && (n.background.color = { rgb: x });
    let C = l(k, 'w', 'themeColor');
    C && (n.background.themeColor = C);
    let P = l(k, 'w', 'themeTint');
    P && (n.background.themeTint = P);
    let S = l(k, 'w', 'themeShade');
    S && (n.background.themeShade = S);
  }
  let A = f(e, 'w', 'footnotePr');
  if (A) {
    let x = dr(A);
    Object.keys(x).length > 0 && (n.footnotePr = x);
  }
  let X = f(e, 'w', 'endnotePr');
  if (X) {
    let x = mr(X);
    Object.keys(x).length > 0 && (n.endnotePr = x);
  }
  let I = f(e, 'w', 'docGrid');
  if (I) {
    n.docGrid = {};
    let x = l(I, 'w', 'type');
    (x === 'default' || x === 'lines' || x === 'linesAndChars' || x === 'snapToChars') &&
      (n.docGrid.type = x);
    let C = T(I, 'w', 'linePitch');
    C !== void 0 && (n.docGrid.linePitch = C);
    let P = T(I, 'w', 'charSpace');
    P !== void 0 && (n.docGrid.charSpace = P);
  }
  let M = f(e, 'w', 'paperSrc');
  if (M) {
    let x = T(M, 'w', 'first');
    x !== void 0 && (n.paperSrcFirst = x);
    let C = T(M, 'w', 'other');
    C !== void 0 && (n.paperSrcOther = C);
  }
  return n;
}
function pr() {
  return {
    pageWidth: 12240,
    pageHeight: 15840,
    orientation: 'portrait',
    marginTop: 1440,
    marginBottom: 1440,
    marginLeft: 1440,
    marginRight: 1440,
    headerDistance: 720,
    footerDistance: 720,
    gutter: 0,
    columnCount: 1,
    columnSpace: 720,
    equalWidth: true,
    sectionStart: 'nextPage',
    verticalAlign: 'top',
  };
}
function bi(e, t) {
  return !e && !t
    ? true
    : !(
        !e ||
        !t ||
        e.bold !== t.bold ||
        e.boldCs !== t.boldCs ||
        e.italic !== t.italic ||
        e.italicCs !== t.italicCs ||
        e.strike !== t.strike ||
        e.doubleStrike !== t.doubleStrike ||
        e.smallCaps !== t.smallCaps ||
        e.allCaps !== t.allCaps ||
        e.hidden !== t.hidden ||
        e.emboss !== t.emboss ||
        e.imprint !== t.imprint ||
        e.outline !== t.outline ||
        e.shadow !== t.shadow ||
        e.rtl !== t.rtl ||
        e.cs !== t.cs ||
        e.fontSize !== t.fontSize ||
        e.fontSizeCs !== t.fontSizeCs ||
        e.spacing !== t.spacing ||
        e.position !== t.position ||
        e.scale !== t.scale ||
        e.kerning !== t.kerning ||
        e.vertAlign !== t.vertAlign ||
        e.highlight !== t.highlight ||
        e.effect !== t.effect ||
        e.emphasisMark !== t.emphasisMark ||
        e.styleId !== t.styleId ||
        !Ti(e.underline, t.underline) ||
        !qe(e.color, t.color) ||
        !xi(e.shading, t.shading) ||
        !Fi(e.fontFamily, t.fontFamily)
      );
}
function Ti(e, t) {
  return !e && !t ? true : !e || !t || e.style !== t.style ? false : qe(e.color, t.color);
}
function qe(e, t) {
  return !e && !t
    ? true
    : !e || !t
      ? false
      : e.rgb === t.rgb &&
        e.auto === t.auto &&
        e.themeColor === t.themeColor &&
        e.themeTint === t.themeTint &&
        e.themeShade === t.themeShade;
}
function xi(e, t) {
  return !e && !t
    ? true
    : !(!e || !t || e.pattern !== t.pattern || !qe(e.color, t.color) || !qe(e.fill, t.fill));
}
function Fi(e, t) {
  return !e && !t
    ? true
    : !e || !t
      ? false
      : e.ascii === t.ascii &&
        e.hAnsi === t.hAnsi &&
        e.eastAsia === t.eastAsia &&
        e.cs === t.cs &&
        e.asciiTheme === t.asciiTheme &&
        e.hAnsiTheme === t.hAnsiTheme &&
        e.eastAsiaTheme === t.eastAsiaTheme &&
        e.csTheme === t.csTheme;
}
function Ei(e) {
  return e.type === 'text' || e.type === 'softHyphen' || e.type === 'noBreakHyphen';
}
function gr(e) {
  return e.content.length === 0 ? true : e.content.every(Ei);
}
function Ci(e, t) {
  let n = [];
  for (let r of e) n.push(r);
  if (n.length > 0 && t.length > 0 && n[n.length - 1].type === 'text' && t[0].type === 'text') {
    let r = n[n.length - 1],
      o = t[0];
    n[n.length - 1] = {
      type: 'text',
      text: r.text + o.text,
      preserveSpace: r.preserveSpace || o.preserveSpace || void 0,
    };
    for (let i = 1; i < t.length; i++) n.push(t[i]);
  } else for (let r of t) n.push(r);
  return n;
}
function Si(e) {
  if (e.length <= 1) return e;
  let t = [],
    n = null;
  for (let r of e)
    if (r.content.length !== 0) {
      if (n === null) {
        n = { ...r, content: [...r.content] };
        continue;
      }
      gr(n) && gr(r) && bi(n.formatting, r.formatting)
        ? (n = { type: 'run', formatting: n.formatting, content: Ci(n.content, r.content) })
        : (t.push(n), (n = { ...r, content: [...r.content] }));
    }
  return (n !== null && t.push(n), t);
}
function Et(e) {
  if (e.length <= 1) return e;
  let t = [],
    n = [];
  function r() {
    if (n.length > 0) {
      let o = Si(n);
      (t.push(...o), (n.length = 0));
    }
  }
  for (let o of e)
    if (o.type === 'run') n.push(o);
    else if ((r(), o.type === 'hyperlink')) {
      let i = { ...o, children: Et(o.children) };
      t.push(i);
    } else t.push(o);
  return (r(), t);
}
function vi(e) {
  let t = { sdtType: 'richText' };
  if (!e || !e.elements) return t;
  for (let n of e.elements) {
    if (n.type !== 'element') continue;
    switch (n.name?.replace(/^w:/, '') ?? '') {
      case 'alias':
        t.alias = l(n, 'w', 'val') ?? void 0;
        break;
      case 'tag':
        t.tag = l(n, 'w', 'val') ?? void 0;
        break;
      case 'lock':
        t.lock = l(n, 'w', 'val') ?? 'unlocked';
        break;
      case 'placeholder': {
        let o = f(n, 'w', 'docPart');
        if (o) {
          let i = f(o, 'w', 'val');
          t.placeholder = i ? (l(i, 'w', 'val') ?? void 0) : void 0;
        }
        break;
      }
      case 'showingPlcHdr':
        t.showingPlaceholder = true;
        break;
      case 'text':
        t.sdtType = 'plainText';
        break;
      case 'date':
        ((t.sdtType = 'date'), (t.dateFormat = l(n, 'w', 'fullDate') ?? void 0));
        break;
      case 'dropDownList':
        ((t.sdtType = 'dropdown'), (t.listItems = hr(n)));
        break;
      case 'comboBox':
        ((t.sdtType = 'comboBox'), (t.listItems = hr(n)));
        break;
      case 'checkbox': {
        t.sdtType = 'checkbox';
        let o = f(n, 'w14', 'checked') ?? f(n, 'w', 'checked');
        t.checked = o ? l(o, 'w14', 'val') === '1' || l(o, 'w', 'val') === '1' : false;
        break;
      }
      case 'picture':
        t.sdtType = 'picture';
        break;
      case 'docPartObj':
        t.sdtType = 'buildingBlockGallery';
        break;
      case 'group':
        t.sdtType = 'group';
        break;
    }
  }
  return t;
}
function hr(e) {
  let t = [];
  for (let n of e.elements ?? [])
    n.type === 'element' &&
      (n.name === 'w:listItem' || n.name?.endsWith(':listItem')) &&
      t.push({ displayText: l(n, 'w', 'displayText') ?? '', value: l(n, 'w', 'value') ?? '' });
  return t;
}
function yr(e) {
  let t = '';
  if (e.type === 'text' && typeof e.text == 'string') return e.text;
  if (e.elements)
    for (let n of e.elements)
      if ((n.name?.replace(/^.*:/, '') ?? '') === 't' && n.elements)
        for (let o of n.elements) o.type === 'text' && typeof o.text == 'string' && (t += o.text);
      else t += yr(n);
  return t;
}
function ki(e, t, n, r) {
  let o = {};
  return (
    e && e !== 'auto' ? (o.rgb = e) : e === 'auto' && (o.auto = true),
    t && (o.themeColor = t),
    n && (o.themeTint = n),
    r && (o.themeShade = r),
    o
  );
}
function Ai(e) {
  if (!e) return;
  let t = {},
    n = l(e, 'w', 'color');
  n && n !== 'auto' && (t.color = { rgb: n });
  let r = l(e, 'w', 'fill');
  r && r !== 'auto' && (t.fill = { rgb: r });
  let o = l(e, 'w', 'themeFill');
  o && ((t.fill = t.fill || {}), (t.fill.themeColor = o));
  let i = l(e, 'w', 'themeFillTint');
  i && t.fill && (t.fill.themeTint = i);
  let a = l(e, 'w', 'themeFillShade');
  a && t.fill && (t.fill.themeShade = a);
  let u = l(e, 'w', 'val');
  return (u && (t.pattern = u), Object.keys(t).length > 0 ? t : void 0);
}
function Se(e) {
  if (!e) return;
  let t = l(e, 'w', 'val');
  if (!t) return;
  let n = { style: t },
    r = l(e, 'w', 'color'),
    o = l(e, 'w', 'themeColor');
  (r || o) && (n.color = ki(r, o, l(e, 'w', 'themeTint'), l(e, 'w', 'themeShade')));
  let i = T(e, 'w', 'sz');
  i !== void 0 && (n.size = i);
  let a = T(e, 'w', 'space');
  a !== void 0 && (n.space = a);
  let u = l(e, 'w', 'shadow');
  u && (n.shadow = u === '1' || u === 'true');
  let d = l(e, 'w', 'frame');
  return (d && (n.frame = d === '1' || d === 'true'), n);
}
function Ni(e) {
  if (!e) return;
  let t = U(e, 'w', 'tab');
  if (t.length === 0) return;
  let n = [];
  for (let r of t) {
    let o = T(r, 'w', 'pos'),
      i = l(r, 'w', 'val');
    if (o !== void 0 && i) {
      let a = { position: o, alignment: i },
        u = l(r, 'w', 'leader');
      (u && (a.leader = u), n.push(a));
    }
  }
  return n.length > 0 ? n : void 0;
}
function Mi(e) {
  if (!e) return;
  let t = {},
    n = T(e, 'w', 'w');
  n !== void 0 && (t.width = n);
  let r = T(e, 'w', 'h');
  r !== void 0 && (t.height = r);
  let o = l(e, 'w', 'hAnchor');
  (o === 'text' || o === 'margin' || o === 'page') && (t.hAnchor = o);
  let i = l(e, 'w', 'vAnchor');
  (i === 'text' || i === 'margin' || i === 'page') && (t.vAnchor = i);
  let a = T(e, 'w', 'x');
  a !== void 0 && (t.x = a);
  let u = T(e, 'w', 'y');
  u !== void 0 && (t.y = u);
  let d = l(e, 'w', 'xAlign');
  d && (t.xAlign = d);
  let p = l(e, 'w', 'yAlign');
  p && (t.yAlign = p);
  let h = l(e, 'w', 'wrap');
  return (h && (t.wrap = h), Object.keys(t).length > 0 ? t : void 0);
}
function br(e, t, n) {
  if (!e) return;
  let r = {},
    o = f(e, 'w', 'jc');
  if (o) {
    let S = l(o, 'w', 'val');
    S && (r.alignment = S);
  }
  let i = f(e, 'w', 'bidi');
  i && (r.bidi = N(i));
  let a = f(e, 'w', 'spacing');
  if (a) {
    let S = T(a, 'w', 'before');
    S !== void 0 && (r.spaceBefore = S);
    let R = T(a, 'w', 'after');
    R !== void 0 && (r.spaceAfter = R);
    let m = T(a, 'w', 'line');
    m !== void 0 && (r.lineSpacing = m);
    let O = l(a, 'w', 'lineRule');
    O && (r.lineSpacingRule = O);
    let W = l(a, 'w', 'beforeAutospacing');
    W && (r.beforeAutospacing = W === '1' || W === 'true');
    let Y = l(a, 'w', 'afterAutospacing');
    Y && (r.afterAutospacing = Y === '1' || Y === 'true');
  }
  let u = f(e, 'w', 'ind');
  if (u) {
    let S = T(u, 'w', 'left');
    S !== void 0 && (r.indentLeft = S);
    let R = T(u, 'w', 'right');
    R !== void 0 && (r.indentRight = R);
    let m = T(u, 'w', 'firstLine');
    m !== void 0 && (r.indentFirstLine = m);
    let O = T(u, 'w', 'hanging');
    O !== void 0 && ((r.indentFirstLine = -O), (r.hangingIndent = true));
    let W = T(u, 'w', 'start');
    W !== void 0 && r.indentLeft === void 0 && (r.indentLeft = W);
    let Y = T(u, 'w', 'end');
    Y !== void 0 && r.indentRight === void 0 && (r.indentRight = Y);
  }
  let d = f(e, 'w', 'pBdr');
  if (d) {
    let S = {},
      R = Se(f(d, 'w', 'top'));
    R && (S.top = R);
    let m = Se(f(d, 'w', 'bottom'));
    m && (S.bottom = m);
    let O = Se(f(d, 'w', 'left'));
    O && (S.left = O);
    let W = Se(f(d, 'w', 'right'));
    W && (S.right = W);
    let Y = Se(f(d, 'w', 'between'));
    Y && (S.between = Y);
    let oe = Se(f(d, 'w', 'bar'));
    (oe && (S.bar = oe), Object.keys(S).length > 0 && (r.borders = S));
  }
  let p = f(e, 'w', 'shd');
  p && (r.shading = Ai(p));
  let h = f(e, 'w', 'tabs');
  h && (r.tabs = Ni(h));
  let w = f(e, 'w', 'keepNext');
  w && (r.keepNext = N(w));
  let E = f(e, 'w', 'keepLines');
  E && (r.keepLines = N(E));
  let v = f(e, 'w', 'widowControl');
  v && (r.widowControl = N(v));
  let y = f(e, 'w', 'pageBreakBefore');
  y && (r.pageBreakBefore = N(y));
  let k = f(e, 'w', 'contextualSpacing');
  k && (r.contextualSpacing = N(k));
  let A = f(e, 'w', 'numPr');
  if (A) {
    let S = f(A, 'w', 'numId'),
      R = f(A, 'w', 'ilvl');
    if (S || R) {
      if (((r.numPr = {}), S)) {
        let m = T(S, 'w', 'val');
        m !== void 0 && (r.numPr.numId = m);
      }
      if (R) {
        let m = T(R, 'w', 'val');
        m !== void 0 && (r.numPr.ilvl = m);
      }
    }
  }
  let X = f(e, 'w', 'outlineLvl');
  if (X) {
    let S = T(X, 'w', 'val');
    S !== void 0 && (r.outlineLevel = S);
  }
  let I = f(e, 'w', 'pStyle');
  if (I) {
    let S = l(I, 'w', 'val');
    S && (r.styleId = S);
  }
  let M = f(e, 'w', 'framePr');
  M && (r.frame = Mi(M));
  let x = f(e, 'w', 'suppressLineNumbers');
  x && (r.suppressLineNumbers = N(x));
  let C = f(e, 'w', 'suppressAutoHyphens');
  C && (r.suppressAutoHyphens = N(C));
  let P = f(e, 'w', 'rPr');
  return (P && (r.runProperties = Ue(P, t)), Object.keys(r).length > 0 ? r : void 0);
}
function Ct(e) {
  if (!e) return '';
  let t = e.indexOf(':');
  return t >= 0 ? e.substring(t + 1) : e;
}
function wr(e, t) {
  if (!e) return `w:${t}`;
  let n = e.indexOf(':');
  return n < 0 ? t : `${e.substring(0, n + 1)}${t}`;
}
function Tr(e) {
  if (e.type !== 'element') return e;
  let t = Ct(e.name),
    n = e.name;
  return (
    t === 'delText' ? (n = wr(e.name, 't')) : t === 'delInstrText' && (n = wr(e.name, 'instrText')),
    { ...e, name: n, elements: e.elements?.map(Tr) }
  );
}
function Me(e) {
  let t = l(e, 'w', 'id'),
    n = t ? parseInt(t, 10) : 0,
    r = l(e, 'w', 'author'),
    o = l(e, 'w', 'date'),
    i = r?.trim() ?? '',
    a = o?.trim() ?? '';
  return {
    id: Number.isInteger(n) && n >= 0 ? n : 0,
    author: i.length > 0 ? i : 'Unknown',
    date: a.length > 0 ? a : void 0,
  };
}
function Pi(e) {
  let t = Me(e),
    n = (l(e, 'w', 'rsid') ?? '').trim();
  return n.length > 0 ? { ...t, rsid: n } : t;
}
function Ri(e, t, n, r) {
  if (!e) return;
  let o = U(e, 'w', 'pPrChange')
    .map((i) => {
      let a = f(i, 'w', 'pPr');
      return {
        type: 'paragraphPropertyChange',
        info: Pi(i),
        previousFormatting: br(a, t),
        currentFormatting: r,
      };
    })
    .filter((i) => i.previousFormatting || i.currentFormatting);
  return o.length > 0 ? o : void 0;
}
function Ii(e, t, n, r, o) {
  return zn(e, t, n, r, o);
}
function Bi(e) {
  return Gn(e);
}
function Di(e) {
  return qn(e);
}
function xr(e) {
  let t = e.trim().match(/^\\?([A-Z]+)/i);
  if (!t) return 'UNKNOWN';
  let n = t[1].toUpperCase();
  return [
    'PAGE',
    'NUMPAGES',
    'NUMWORDS',
    'NUMCHARS',
    'DATE',
    'TIME',
    'CREATEDATE',
    'SAVEDATE',
    'PRINTDATE',
    'AUTHOR',
    'TITLE',
    'SUBJECT',
    'KEYWORDS',
    'COMMENTS',
    'FILENAME',
    'FILESIZE',
    'TEMPLATE',
    'DOCPROPERTY',
    'DOCVARIABLE',
    'REF',
    'PAGEREF',
    'NOTEREF',
    'HYPERLINK',
    'TOC',
    'TOA',
    'INDEX',
    'SEQ',
    'STYLEREF',
    'AUTONUM',
    'AUTONUMLGL',
    'AUTONUMOUT',
    'IF',
    'MERGEFIELD',
    'NEXT',
    'NEXTIF',
    'ASK',
    'SET',
    'QUOTE',
    'INCLUDETEXT',
    'INCLUDEPICTURE',
    'SYMBOL',
    'ADVANCE',
    'EDITTIME',
    'REVNUM',
    'SECTION',
    'SECTIONPAGES',
    'USERADDRESS',
    'USERNAME',
    'USERINITIALS',
  ].includes(n)
    ? n
    : 'UNKNOWN';
}
function Li(e, t, n, r, o) {
  let i = l(e, 'w', 'instr') ?? '',
    a = xr(i),
    u = { type: 'simpleField', instruction: i, fieldType: a, content: [] },
    d = l(e, 'w', 'fldLock');
  (d === '1' || d === 'true') && (u.fldLock = true);
  let p = l(e, 'w', 'dirty');
  (p === '1' || p === 'true') && (u.dirty = true);
  let h = K(e);
  for (let w of h) Ct(w.name) === 'r' && u.content.push(Ae(w, t, n, r, o));
  return u;
}
function ve(e, t, n, r, o, i, a = 'default') {
  let u = [],
    d = K(e),
    p = false,
    h = '',
    w = [],
    E = [],
    v = false,
    y = false,
    k = false;
  for (let A of d) {
    let X = Ct(A.name);
    switch (X) {
      case 'r': {
        let I = a === 'deletion' ? Tr(A) : A,
          M = Ae(I, t, n, o, i),
          x = false,
          C = false,
          P = false,
          S = '';
        for (let R of M.content)
          R.type === 'fieldChar'
            ? R.charType === 'begin'
              ? ((x = true), R.fldLock && (y = true), R.dirty && (k = true))
              : R.charType === 'separate'
                ? (C = true)
                : R.charType === 'end' && (P = true)
            : R.type === 'instrText' && (S += R.text);
        if (
          (x && ((p = true), (v = false), (h = ''), (w = []), (E = []), (y = false), (k = false)),
          p)
        ) {
          if (
            (S && (h += S), C && (v = true), v && !P ? C || E.push(M) : !v && !x && w.push(M), P)
          ) {
            let R = {
              type: 'complexField',
              instruction: h.trim(),
              fieldType: xr(h),
              fieldCode: w,
              fieldResult: E,
            };
            (y && (R.fldLock = true), k && (R.dirty = true), u.push(R), (p = false));
          }
        } else u.push(M);
        break;
      }
      case 'hyperlink':
        u.push(Ii(A, o, t, n, i));
        break;
      case 'bookmarkStart':
        u.push(Bi(A));
        break;
      case 'bookmarkEnd':
        u.push(Di(A));
        break;
      case 'fldSimple':
        u.push(Li(A, t, n, o, i));
        break;
      case 'pPr':
        break;
      case 'proofErr':
      case 'permStart':
      case 'permEnd':
      case 'customXml':
        break;
      case 'sdt': {
        let I = (A.elements ?? []).find(
            (x) => x.type === 'element' && (x.name === 'w:sdtPr' || x.name?.endsWith(':sdtPr'))
          ),
          M = (A.elements ?? []).find(
            (x) =>
              x.type === 'element' && (x.name === 'w:sdtContent' || x.name?.endsWith(':sdtContent'))
          );
        if (M) {
          let x = ve(M, t, n, null, o, i, a),
            P = {
              type: 'inlineSdt',
              properties: vi(I ?? null),
              content: x.filter((S) => S.type === 'run' || S.type === 'hyperlink'),
            };
          u.push(P);
        }
        break;
      }
      case 'ins': {
        let I = Me(A),
          M = ve(A, t, n, null, o, i),
          x = {
            type: 'insertion',
            info: I,
            content: M.filter((C) => C.type === 'run' || C.type === 'hyperlink'),
          };
        u.push(x);
        break;
      }
      case 'del': {
        let I = Me(A),
          M = ve(A, t, n, null, o, i, 'deletion'),
          x = {
            type: 'deletion',
            info: I,
            content: M.filter((C) => C.type === 'run' || C.type === 'hyperlink'),
          };
        u.push(x);
        break;
      }
      case 'moveFrom': {
        let I = Me(A),
          M = ve(A, t, n, null, o, i, 'deletion'),
          x = {
            type: 'moveFrom',
            info: I,
            content: M.filter((C) => C.type === 'run' || C.type === 'hyperlink'),
          };
        u.push(x);
        break;
      }
      case 'moveTo': {
        let I = Me(A),
          M = ve(A, t, n, null, o, i),
          x = {
            type: 'moveTo',
            info: I,
            content: M.filter((C) => C.type === 'run' || C.type === 'hyperlink'),
          };
        u.push(x);
        break;
      }
      case 'smartTag':
        break;
      case 'moveFromRangeStart': {
        let I = parseInt(l(A, 'w', 'id') ?? '0', 10),
          M = l(A, 'w', 'name') ?? '';
        u.push({ type: 'moveFromRangeStart', id: I, name: M });
        break;
      }
      case 'moveFromRangeEnd': {
        let I = parseInt(l(A, 'w', 'id') ?? '0', 10);
        u.push({ type: 'moveFromRangeEnd', id: I });
        break;
      }
      case 'moveToRangeStart': {
        let I = parseInt(l(A, 'w', 'id') ?? '0', 10),
          M = l(A, 'w', 'name') ?? '';
        u.push({ type: 'moveToRangeStart', id: I, name: M });
        break;
      }
      case 'moveToRangeEnd': {
        let I = parseInt(l(A, 'w', 'id') ?? '0', 10);
        u.push({ type: 'moveToRangeEnd', id: I });
        break;
      }
      case 'commentRangeStart': {
        let I = parseInt(l(A, 'w', 'id') ?? '0', 10);
        u.push({ type: 'commentRangeStart', id: I });
        break;
      }
      case 'commentRangeEnd': {
        let I = parseInt(l(A, 'w', 'id') ?? '0', 10);
        u.push({ type: 'commentRangeEnd', id: I });
        break;
      }
      case 'oMath':
      case 'oMathPara': {
        let I = X === 'oMathPara',
          M = cn(A),
          x = yr(A),
          C = {
            type: 'mathEquation',
            display: I ? 'block' : 'inline',
            ommlXml: M,
            plainText: x || void 0,
          };
        u.push(C);
        break;
      }
    }
  }
  return u;
}
function le(e, t, n, r, o = null, i = null) {
  let a = { type: 'paragraph', content: [] },
    u = l(e, 'w14', 'paraId') ?? l(e, 'w', 'paraId');
  u && (a.paraId = u);
  let d = l(e, 'w14', 'textId') ?? l(e, 'w', 'textId');
  d && (a.textId = d);
  let p = f(e, 'w', 'pPr');
  if (p) {
    ((a.formatting = br(p, n)), (a.propertyChanges = Ri(p, n, t, a.formatting)));
    let E = f(p, 'w', 'sectPr');
    E && (a.sectionProperties = Ge(E));
  }
  let h = ve(e, t, n, r, o, i);
  a.content = Et(h);
  let w = a.formatting?.numPr;
  if (!w && a.formatting?.styleId && t) {
    let E = t.get(a.formatting.styleId);
    E?.pPr?.numPr &&
      ((w = E.pPr.numPr), a.formatting || (a.formatting = {}), (a.formatting.numPr = w));
  }
  if (w && r) {
    let { numId: E, ilvl: v = 0 } = w;
    if (E !== void 0 && E !== 0) {
      let y = r.getLevel(E, v);
      if (
        y &&
        ((a.listRendering = {
          level: v,
          numId: E,
          marker: y.lvlText,
          isBullet: y.numFmt === 'bullet',
          numFmt: y.numFmt,
          markerHidden: y.rPr?.hidden || void 0,
          markerFontFamily: y.rPr?.fontFamily?.ascii || y.rPr?.fontFamily?.hAnsi || void 0,
          markerFontSize: y.rPr?.fontSize ? y.rPr.fontSize / 2 : void 0,
        }),
        y.pPr)
      ) {
        a.formatting || (a.formatting = {});
        let k = p ? f(p, 'w', 'ind') : null,
          A = k != null && (l(k, 'w', 'left') !== null || l(k, 'w', 'start') !== null),
          X = k != null && (l(k, 'w', 'firstLine') !== null || l(k, 'w', 'hanging') !== null);
        (!A && y.pPr.indentLeft !== void 0 && (a.formatting.indentLeft = y.pPr.indentLeft),
          X ||
            (y.pPr.indentFirstLine !== void 0 &&
              (a.formatting.indentFirstLine = y.pPr.indentFirstLine),
            y.pPr.hangingIndent !== void 0 && (a.formatting.hangingIndent = y.pPr.hangingIndent)));
      }
    }
  }
  return a;
}
function St(e) {
  let t = '';
  for (let n of e.content)
    if (n.type === 'run')
      for (let r of n.content)
        r.type === 'text'
          ? (t += r.text)
          : r.type === 'tab'
            ? (t += '	')
            : r.type === 'break' &&
              (r.breakType === 'page'
                ? (t += '\f')
                : (t += `
`));
    else if (n.type === 'hyperlink') {
      for (let r of n.children)
        if (r.type === 'run') for (let o of r.content) o.type === 'text' && (t += o.text);
    } else if (n.type === 'simpleField') {
      for (let r of n.content)
        if (r.type === 'run') for (let o of r.content) o.type === 'text' && (t += o.text);
    } else if (n.type === 'complexField')
      for (let r of n.fieldResult) for (let o of r.content) o.type === 'text' && (t += o.text);
  return t;
}
function Xi(e) {
  if (!e || e.trim() === '') return '\u2022';
  let t = e.charCodeAt(0),
    n = {
      183: '\u2022',
      111: '\u25CB',
      167: '\u25A0',
      252: '\u2713',
      110: '\u25A0',
      113: '\u25CB',
      117: '\u25C6',
      118: '\u2756',
      168: '\u2713',
      251: '\u2713',
      254: '\u2713',
      61623: '\u2022',
      61550: '\u25A0',
      61551: '\u25CB',
      61607: '\u25A0',
      61692: '\u2713',
      8226: '\u2022',
      9679: '\u25CF',
      9675: '\u25CB',
      9632: '\u25A0',
      9633: '\u25A1',
      9670: '\u25C6',
      9671: '\u25C7',
      8211: '\u2013',
      8212: '\u2014',
      62: '>',
      45: '-',
    };
  return n[t] ? n[t] : (t >= 57344 && t <= 63743) || t < 32 || (t >= 127 && t < 160) ? '\u2022' : e;
}
function Oi(e, t, n) {
  let r = e.listRendering;
  if (!r || !t) return;
  let { numId: o, level: i } = r;
  if (o === void 0 || o === 0) return;
  n.has(o) || n.set(o, new Array(9).fill(0));
  let a = n.get(o);
  a[i] = (a[i] || 0) + 1;
  for (let p = i + 1; p < a.length; p++) a[p] = 0;
  let u = r.marker;
  if (r.isBullet) {
    let p = u || '';
    r.marker = Xi(p);
    return;
  }
  let d = u;
  for (let p = 0; p <= i; p++) {
    let h = `%${p + 1}`;
    if (d.includes(h)) {
      let w = a[p],
        E = t.getLevel(o, p),
        v = _i(w, E?.numFmt || 'decimal');
      d = d.replace(h, v);
    }
  }
  r.marker = d;
}
function _i(e, t) {
  switch (t) {
    case 'decimal':
    case 'decimalZero':
      return String(e);
    case 'lowerLetter':
      return String.fromCharCode(96 + ((e - 1) % 26) + 1);
    case 'upperLetter':
      return String.fromCharCode(64 + ((e - 1) % 26) + 1);
    case 'lowerRoman':
      return Fr(e).toLowerCase();
    case 'upperRoman':
      return Fr(e);
    case 'bullet':
      return '\u2022';
    default:
      return String(e);
  }
}
function Fr(e) {
  let t = [
      [1e3, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ],
    n = '';
  for (let [r, o] of t) for (; e >= r; ) ((n += o), (e -= r));
  return n;
}
var Er = /\{([a-zA-Z_][a-zA-Z0-9_\-\.]*)\}/g;
function Cr(e) {
  let t = [],
    n;
  for (Er.lastIndex = 0; (n = Er.exec(e)) !== null; ) {
    let r = n[1].trim();
    r && !t.includes(r) && t.push(r);
  }
  return t;
}
function Sr(e) {
  let t = [];
  for (let n of e)
    if (n.type === 'paragraph') {
      let r = St(n),
        o = Cr(r);
      for (let i of o) t.includes(i) || t.push(i);
    } else if (n.type === 'table') {
      let r = vr(n);
      for (let o of r) t.includes(o) || t.push(o);
    }
  return t;
}
function vr(e) {
  let t = [];
  for (let n of e.rows)
    for (let r of n.cells)
      for (let o of r.content)
        if (o.type === 'paragraph') {
          let i = St(o),
            a = Cr(i);
          for (let u of a) t.includes(u) || t.push(u);
        } else if (o.type === 'table') {
          let i = vr(o);
          for (let a of i) t.includes(a) || t.push(a);
        }
  return t;
}
function Hi(e, t, n, r, o, i, a) {
  if (e.content.length === 0) return;
  let u = K(t),
    d = 0;
  for (let p of u) {
    if (Te(p.name ?? '') !== 'r') continue;
    let h = K(p);
    for (let w of h)
      if (Te(w.name ?? '') === 'drawing' && je(w)) {
        let E = Bn(w);
        if (E) {
          let v = ut(w, 'wps', 'wsp');
          if (v) {
            let A = Dn(v);
            A && (E.content = In(A, le, null, n, r, o, i ?? void 0));
          }
          let y = {
            type: 'shape',
            shapeType: 'rect',
            size: E.size,
            position: E.position,
            wrap: E.wrap,
            fill: E.fill,
            outline: E.outline,
            textBody: { content: E.content, margins: E.margins },
          };
          E.id && (y.id = E.id);
          let k = { type: 'shape', shape: y };
          if (d < e.content.length) {
            let A = e.content[d];
            A.type === 'run' && A.content.push(k);
          }
        }
      }
    d++;
  }
}
function kr(e, t, n, r, o, i) {
  let a = [],
    u = K(e),
    d = new Map();
  for (let p of u) {
    let h = p.name ?? '';
    if (h === 'w:p' || h.endsWith(':p')) {
      let w = le(p, t, n, r, o, i);
      (Hi(w, p, t, n, r, o), Oi(w, r, d), a.push(w));
    } else if (h === 'w:tbl' || h.endsWith(':tbl')) {
      let w = Ne(p, t, n, r, o, i);
      a.push(w);
    } else if (h === 'w:sdt' || h.endsWith(':sdt')) {
      let w = (p.elements ?? []).find(
        (E) =>
          E.type === 'element' && (E.name === 'w:sdtContent' || E.name?.endsWith(':sdtContent'))
      );
      if (w) {
        let E = kr(w, t, n, r, o, i);
        a.push(...E);
      }
    }
  }
  return a;
}
function Vi(e, t) {
  let n = [],
    r = [];
  for (let o of e)
    (r.push(o),
      o.type === 'paragraph' &&
        o.sectionProperties &&
        (n.push({ properties: o.sectionProperties, content: r }), (r = [])));
  return ((r.length > 0 || n.length === 0) && n.push({ properties: t ?? pr(), content: r }), n);
}
function Ar(e, t = null, n = null, r = null, o = null, i = null) {
  let a = { content: [] };
  if (!e) return a;
  let u = ae(e);
  if (!u) return a;
  let d = (u.elements ?? []).find(
    (w) => w.type === 'element' && (w.name === 'w:document' || w.name?.endsWith(':document'))
  );
  if (!d) return a;
  let p = f(d, 'w', 'body');
  if (!p) return a;
  a.content = kr(p, t, n, r, o, i);
  let h = f(p, 'w', 'sectPr');
  return (
    h && (a.finalSectionProperties = Ge(h)),
    (a.sections = Vi(a.content, a.finalSectionProperties)),
    a
  );
}
function ji(e) {
  let t = new Map(),
    n = ae(e);
  if (!n) return t;
  let r = f(n, 'w16cex', 'commentsExtensible') ?? n;
  for (let o of K(r)) {
    if ((o.name?.replace(/^.*:/, '') ?? '') !== 'comment') continue;
    let a =
        l(o, 'w16cex', 'paraId') ??
        l(o, 'w15', 'paraId') ??
        o.attributes?.['w16cex:paraId'] ??
        o.attributes?.['w15:paraId'],
      u =
        l(o, 'w16cex', 'dateUtc') ??
        l(o, 'w15', 'dateUtc') ??
        o.attributes?.['w16cex:dateUtc'] ??
        o.attributes?.['w15:dateUtc'];
    a && u && t.set(String(a).toUpperCase(), String(u));
  }
  return t;
}
function Nr(e, t, n, r, o, i) {
  if (!e) return [];
  let a = ae(e);
  if (!a) return [];
  let u = i ? ji(i) : new Map(),
    d = f(a, 'w', 'comments') ?? a,
    p = K(d),
    h = [];
  for (let w of p) {
    if ((w.name?.replace(/^.*:/, '') ?? '') !== 'comment') continue;
    let v = parseInt(l(w, 'w', 'id') ?? '0', 10),
      y = l(w, 'w', 'author') ?? 'Unknown',
      k = l(w, 'w', 'initials'),
      A = k != null ? String(k) : void 0,
      X = l(w, 'w', 'date'),
      I = X != null ? String(X) : void 0,
      M = l(w, 'w14', 'paraId') ?? w.attributes?.['w14:paraId'] ?? l(w, 'w', 'paraId'),
      C = (M ? u.get(String(M).toUpperCase()) : void 0) ?? I,
      P = [];
    for (let S of K(w))
      if ((S.name?.replace(/^.*:/, '') ?? '') === 'p') {
        let m = le(S, t, n, null, r, o);
        P.push(m);
      }
    h.push({ id: v, author: y, initials: A, date: C, content: P });
  }
  return h;
}
async function Os(e, t = {}) {
  let n = e instanceof ArrayBuffer ? e : await Rt(e),
    {
      onProgress: r = () => {},
      preloadFonts: o = true,
      parseHeadersFooters: i = true,
      parseNotes: a = true,
      detectVariables: u = true,
    } = t,
    d = [];
  try {
    let E = function ($, j) {
      let D = performance.now(),
        B = j(),
        G = performance.now() - D;
      return (
        w.push({ stage: $, ms: G }),
        G > 1e3 && console.warn(`[parseDocx] ${$} took ${Math.round(G)}ms`),
        B
      );
    };
    var p = E;
    let h = performance.now(),
      w = [];
    async function v($, j) {
      let D = performance.now(),
        B = await j(),
        G = performance.now() - D;
      return (
        w.push({ stage: $, ms: G }),
        G > 1e3 && console.warn(`[parseDocx] ${$} took ${Math.round(G)}ms`),
        B
      );
    }
    r('Extracting DOCX...', 0);
    let y = await v('unzip', () => Bt(n));
    (r('Extracted DOCX', 10), r('Parsing relationships...', 10));
    let k = E('relationships', () => (y.documentRels ? Oe(y.documentRels) : new Map()));
    (r('Parsed relationships', 15), r('Parsing theme...', 15));
    let A = E('theme', () => gn(y.themeXml));
    (r('Parsed theme', 20), r('Parsing styles...', 20));
    let X = null,
      I;
    (E('styles', () => {
      y.stylesXml && ((X = pt(y.stylesXml, A)), (I = En(y.stylesXml, A)));
    }),
      r('Parsed styles', 30),
      r('Parsing numbering...', 30));
    let M = E('numbering', () => Cn(y.numberingXml));
    (r('Parsed numbering', 35), r('Processing media files...', 35));
    let x = E('media', () => Ui(y, k));
    (r('Processed media', 40), r('Parsing document body...', 40));
    let C = { content: [] };
    (E('documentBody', () => {
      y.documentXml
        ? (C = Ar(y.documentXml, X, A, M, k, x))
        : d.push('No document.xml found in DOCX');
    }),
      r('Parsed document body', 55));
    let P, S;
    if (i) {
      r('Parsing headers/footers...', 55);
      let $ = E('headersFooters', () => Wi(y, X, A, M, k, x));
      ((P = $.headers), (S = $.footers), r('Parsed headers/footers', 65));
    } else r('Skipping headers/footers', 65);
    let R, m;
    if (a) {
      r('Parsing footnotes/endnotes...', 65);
      let $ = E('footnotesEndnotes', () => Ki(y, X, A, M, k, x));
      ((R = $.footnotes), (m = $.endnotes), r('Parsed footnotes/endnotes', 75));
    } else r('Skipping footnotes/endnotes', 75);
    r('Parsing comments...', 75);
    let O = E('comments', () => Nr(y.commentsXml, X, A, k, x, y.commentsExtensibleXml));
    O.length > 0 && (C.comments = O);
    let W;
    (u
      ? (r('Detecting template variables...', 75),
        (W = E('variables', () => Sr(C.content))),
        r('Detected variables', 80))
      : r('Skipping variable detection', 80),
      o
        ? (r('Loading fonts...', 80), await v('fonts', () => zi(A, I, C)), r('Loaded fonts', 95))
        : r('Skipping font loading', 95),
      r('Assembling document...', 95));
    let oe = {
        package: {
          document: C,
          styles: I,
          theme: A,
          numbering: M.definitions,
          headers: P,
          footers: S,
          footnotes: R,
          endnotes: m,
          relationships: k,
          media: x,
        },
        originalBuffer: n,
        templateVariables: W,
        warnings: d.length > 0 ? d : void 0,
      },
      ue = performance.now() - h;
    if (ue > 2e3) {
      let $ = w
        .filter((j) => j.ms > 100)
        .map((j) => `${j.stage}: ${Math.round(j.ms)}ms`)
        .join(', ');
      console.warn(`[parseDocx] Total: ${Math.round(ue)}ms` + ($ ? ` (${$})` : ''));
    }
    return (r('Complete', 100), oe);
  } catch (h) {
    let w = h instanceof Error ? h.message : String(h);
    throw (
      console.error('[parseDocx] Failed to parse DOCX:', w, h),
      new Error(`Failed to parse DOCX: ${w}`)
    );
  }
}
function Ui(e, t) {
  let n = new Map();
  for (let [r, o] of e.media.entries()) {
    let i = r.split('/').pop() || r,
      a = Dt(r),
      u = new Uint8Array(o),
      d = '';
    for (let v = 0; v < u.length; v++) d += String.fromCharCode(u[v]);
    let p = btoa(d),
      h = `data:${a};base64,${p}`,
      w = { path: r, filename: i, mimeType: a, data: o, dataUrl: h };
    n.set(r, w);
    let E = r.replace(/^word\//, '');
    E !== r && n.set(E, w);
  }
  return n;
}
function $e(e, t) {
  let n = t.toLowerCase();
  for (let [r, o] of e.entries()) if (r.toLowerCase() === n) return o;
}
function Wi(e, t, n, r, o, i) {
  let a = new Map(),
    u = new Map();
  for (let [d, p] of o.entries())
    if (p.type === Xe.header && p.target) {
      let h = p.target.split('/').pop() || p.target,
        w = $e(e.headers, h);
      if (w) {
        let E = `word/_rels/${h}.rels`,
          v = $e(e.allXml, E),
          y = v ? Oe(v) : o,
          k = ir(w, 'default', t, n, r, y, i);
        a.set(d, k);
      }
    } else if (p.type === Xe.footer && p.target) {
      let h = p.target.split('/').pop() || p.target,
        w = $e(e.footers, h);
      if (w) {
        let E = `word/_rels/${h}.rels`,
          v = $e(e.allXml, E),
          y = v ? Oe(v) : o,
          k = ar(w, 'default', t, n, r, y, i);
        u.set(d, k);
      }
    }
  return { headers: a, footers: u };
}
function Ki(e, t, n, r, o, i) {
  let a = lr(e.footnotesXml, t, n, r, o, i),
    u = ur(e.endnotesXml, t, n, r, o, i);
  return { footnotes: a.getNormalFootnotes(), endnotes: u.getNormalEndnotes() };
}
async function zi(e, t, n) {
  let r = new Set();
  if (e?.fontScheme) {
    let { majorFont: o, minorFont: i } = e.fontScheme;
    (o?.latin && r.add(o.latin), i?.latin && r.add(i.latin));
  }
  if (
    (t?.docDefaults?.rPr?.fontFamily?.ascii && r.add(t.docDefaults.rPr.fontFamily.ascii), t?.styles)
  )
    for (let o of t.styles)
      (o.rPr?.fontFamily?.ascii && r.add(o.rPr.fontFamily.ascii),
        o.rPr?.fontFamily?.hAnsi && r.add(o.rPr.fontFamily.hAnsi));
  if (n.content) {
    for (let o of n.content)
      if (o.type === 'paragraph')
        for (let i of o.content)
          i.type === 'run' &&
            i.formatting?.fontFamily &&
            (i.formatting.fontFamily.ascii && r.add(i.formatting.fontFamily.ascii),
            i.formatting.fontFamily.hAnsi && r.add(i.formatting.fontFamily.hAnsi));
  }
  if (r.size > 0)
    try {
      await ot(Array.from(r));
    } catch (o) {
      console.warn('Failed to load some fonts:', o);
    }
}
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/ exports.a = Xe;
exports.b = os;
exports.c = rt;
exports.d = Xr;
exports.e = Gi;
exports.f = qi;
exports.g = $i;
exports.h = Yi;
exports.i = Zi;
exports.j = Qi;
exports.k = Ji;
exports.l = ea;
exports.m = Rt;
exports.n = Os;
