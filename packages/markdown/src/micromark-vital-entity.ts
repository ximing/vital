import type { Code, Effects, Extension, State, TokenizeContext } from 'micromark-util-types';

const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const COLON = 58;
const DASH = 45;

function isAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isHex(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70)
  );
}

function isEof(code: Code): boolean {
  return code === null || code < 0;
}

/**
 * Micromark construct for `[[task|inbox:<uuid v1–8>]]`.
 * Fails fast so `[link]` / `[[` prose still parse as markdown.
 */
export function vitalEntitySyntax(): Extension {
  return {
    text: {
      [LEFT_BRACKET]: {
        name: 'vitalEntity',
        tokenize: tokenizeVitalEntity,
      },
    },
  };
}

function tokenizeVitalEntity(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const kindChars: number[] = [];
  let uuidPos = 0;

  return start;

  function start(code: Code): State | undefined {
    if (code !== LEFT_BRACKET) return nok(code);
    effects.enter('vitalEntity');
    effects.consume(code);
    return open2;
  }

  function open2(code: Code): State | undefined {
    if (code !== LEFT_BRACKET) return nok(code);
    effects.consume(code);
    return kindChar;
  }

  function kindChar(code: Code): State | undefined {
    if (code === COLON) {
      const kind = String.fromCharCode(...kindChars).toLowerCase();
      if (kind !== 'task' && kind !== 'inbox') return nok(code);
      effects.consume(code);
      return uuidChar;
    }
    if (isEof(code) || kindChars.length >= 5 || typeof code !== 'number' || !isAlpha(code)) {
      return nok(code);
    }
    kindChars.push(code);
    effects.consume(code);
    return kindChar;
  }

  function uuidChar(code: Code): State | undefined {
    if (isEof(code) || typeof code !== 'number') return nok(code);
    if (uuidPos === 36) {
      if (code !== RIGHT_BRACKET) return nok(code);
      effects.consume(code);
      return close2;
    }
    const dashSlot = uuidPos === 8 || uuidPos === 13 || uuidPos === 18 || uuidPos === 23;
    if (dashSlot) {
      if (code !== DASH) return nok(code);
      effects.consume(code);
      uuidPos += 1;
      return uuidChar;
    }
    if (uuidPos === 14) {
      // version nibble 1–8
      if (code < 49 || code > 56) return nok(code);
    } else if (uuidPos === 19) {
      // RFC variant 8/9/a/b
      if (
        code !== 56 &&
        code !== 57 &&
        code !== 97 &&
        code !== 98 &&
        code !== 65 &&
        code !== 66
      ) {
        return nok(code);
      }
    } else if (!isHex(code)) {
      return nok(code);
    }
    effects.consume(code);
    uuidPos += 1;
    return uuidChar;
  }

  function close2(code: Code): State | undefined {
    if (code !== RIGHT_BRACKET) return nok(code);
    effects.consume(code);
    effects.exit('vitalEntity');
    return ok;
  }
}
