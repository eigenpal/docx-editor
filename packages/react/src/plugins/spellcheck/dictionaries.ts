import enUSAff from './dictionaries/en_US.aff';
import enUSDic from './dictionaries/en_US.dic';
import enGBAff from './dictionaries/en_GB.aff';
import enGBDic from './dictionaries/en_GB.dic';

export type SpellcheckLocale = 'en_US' | 'en_GB';

export const dictionaries: Record<SpellcheckLocale, { aff: string; dic: string }> = {
  en_US: { aff: enUSAff, dic: enUSDic },
  en_GB: { aff: enGBAff, dic: enGBDic },
};

export function getDictionary(locale: SpellcheckLocale) {
  return dictionaries[locale];
}
