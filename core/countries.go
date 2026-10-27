package main

import (
	"strings"
	"unicode"
)

// keywords that identify a country inside a server name
var countryWords = map[string][]string{
	"NL": {"netherlands", "нидерланд", "голланд", "amsterdam", "амстердам"},
	"DE": {"germany", "герман", "frankfurt", "франкфурт", "berlin"},
	"FI": {"finland", "финлянд", "helsinki", "хельсинки"},
	"SE": {"sweden", "швец", "stockholm", "стокгольм"},
	"US": {"united states", "usa", "сша", "america", "new york", "нью-йорк", "los angeles"},
	"JP": {"japan", "япон", "tokyo", "токио"},
	"GB": {"united kingdom", "britain", "англи", "великобритан", "london", "лондон"},
	"FR": {"france", "франц", "paris", "париж"},
	"PL": {"poland", "польш", "warsaw", "варшав"},
	"TR": {"turkey", "türkiye", "турц", "istanbul", "стамбул"},
	"KZ": {"kazakhstan", "казахстан", "almaty", "алматы"},
	"EE": {"estonia", "эстон", "tallinn", "таллин"},
	"LV": {"latvia", "латви", "riga", "рига"},
	"LT": {"lithuania", "литв", "vilnius"},
	"CH": {"switzerland", "швейцар", "zurich"},
	"AT": {"austria", "австри", "vienna", "вена"},
	"SG": {"singapore", "сингапур"},
	"HK": {"hong kong", "гонконг"},
	"CA": {"canada", "канад", "toronto"},
	"RU": {"russia", "росси", "moscow", "москв"},
	"AE": {"emirates", "эмират", "dubai", "дубай"},
	"IT": {"italy", "итали", "milan", "милан"},
	"ES": {"spain", "испан", "madrid"},
	"CZ": {"czech", "чехи", "prague", "праг"},
	"RO": {"romania", "румын"},
	"MD": {"moldova", "молдов"},
	"AM": {"armenia", "армени"},
	"GE": {"georgia", "грузи", "tbilisi"},
	"KR": {"korea", "коре", "seoul"},
	"IN": {"india", "инди"},
	"BR": {"brazil", "бразил"},
	"AU": {"australia", "австрал"},
	"NO": {"norway", "норвег"},
	"DK": {"denmark", "дани"},
	"UA": {"ukraine", "украин"},
	"BG": {"bulgaria", "болгар"},
	"RS": {"serbia", "серби"},
	"HU": {"hungary", "венгр"},
	"IL": {"israel", "израил"},
}

func detectCountry(name string) string {
	// flag emoji: two regional indicator symbols
	runes := []rune(name)
	for i := 0; i+1 < len(runes); i++ {
		a, b := runes[i], runes[i+1]
		if a >= 0x1F1E6 && a <= 0x1F1FF && b >= 0x1F1E6 && b <= 0x1F1FF {
			return string([]rune{'A' + (a - 0x1F1E6), 'A' + (b - 0x1F1E6)})
		}
	}
	low := strings.ToLower(name)
	for code, words := range countryWords {
		for _, w := range words {
			if strings.Contains(low, w) {
				return code
			}
		}
	}
	// a standalone two-letter code like "NL-1" or "[DE]"
	fields := strings.FieldsFunc(name, func(r rune) bool { return !unicode.IsLetter(r) })
	for _, f := range fields {
		if len(f) == 2 && strings.ToUpper(f) == f {
			if _, ok := countryWords[f]; ok {
				return f
			}
		}
	}
	return ""
}
