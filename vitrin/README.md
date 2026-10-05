
# Vitrin

Claude Code modu. Claude'un gönderdiği resim, video, PDF, ses, web sayfası ve
markdown belgelerini terminalden çıkmadan sağdaki panelde gösterir.

https://github.com/user-attachments/assets/5ca8d5c2-73b8-4fbf-bb05-477b76b44e5b

Panel canlı bir web sayfasıdır: görünmeyen bir tarayıcı sayfayı çizer, her
kare terminale resim olarak akıtılır, tıklama ve kaydırma sayfaya geri
iletilir. Bu sayede kaydırma akıcıdır ve video panelin içinde sesli oynar.

## Kullanım

- Claude bir medya dosyasının yolunu cevabına yazınca panel kendiliğinden açılır.
- Cevaptaki yola tıklamak paneli o dosyada açar.
- Claude'un okuduğu ya da gönderdiği medya dosyasının araç satırındaki yoluna tıklamak da aynı şeyi yapar.
- `Sohbet` yalnızca cevaplarda geçen medyayı, `Hepsi` araçların ürettiklerini de gösterir.
- Küçük resmin köşesindeki çarpı o dosyayı listeden çıkarır, üst çubuktaki çöp kutusu listeyi boşaltır; dosyalar diskte kalır.
- Uzun bir markdown belgesi kendi penceresinde kaydırılır; seçilen yazı fare bırakılınca panoya kopyalanır.
- `Büyüt` Finder'ın boşluk tuşu önizlemesini, `Aç` varsayılan uygulamayı açar.
- Panele bir kez tıkladıktan sonra ok tuşları medyalar arasında gezdirir, boşluk ya da Enter seçili medyayı büyütür.
- `ctrl` ya da `option` ile ikinci bir medyaya tıklamak ikisini karşılaştırır. Aynı biçimdeki iki resim (önce/sonra) üst üste gelir ve ayırıcı sürüklenir; diğerleri yan yana durur. İki resimde düğmeyle ikisi arasında geçilir.
- Sürükleme sayfaya iletilir: videonun ilerleme çubuğu kaydırılabilir.
- Sayfa hareket ederken (kaydırma, sürükleme, oynayan video) kareler yarı çözünürlükte gönderilir; durunca netleşir.
- `ctrl` ya da `option` basılıyken `Yolu kopyala` düğmesi `Dizini aç` olur: dosyayı Finder'da gösterir.

| Komut | Ne yapar |
| --- | --- |
| `/vitrin` | Paneli açar |
| `/vitrin <dosya>` | Dosyayı ekler ve gösterir |
| `/vitrin hepsi` / `/vitrin sohbet` | Süzgeci değiştirir |
| `/vitrin temizle` | Listeyi boşaltır |
| `/vitrin kapat` | Paneli ve arkadaki tarayıcıyı kapatır |
| `/vitrin oran 0.47` | Sayfanın en-boy oranını terminal yazı tipine göre düzeltir |

## Kurulum

Gerekenler: macOS, Ghostty ya da kitty (resim çizebilen bir terminal; tmux
içinde çalışmaz), Claude Code 2.1.287+, Node 22+, Chrome ya da Brave, ffmpeg,
Xcode komut satırı araçları (`swiftc`).

```sh
git clone https://github.com/yasinozmeen/claude-code-mods.git ~/claude-code-mods
cd ~/claude-code-mods/vitrin
swiftc -O bin/onizle.swift -o bin/onizle
```

Ardından `~/.claude/settings.json` içindeki `env` bölümüne klasörü ekle
(başka modlarla birlikte kullanmak için [ana README](../README.md#kurulum)):

```json
"CLAUDE_CODE_PLUGIN_DIRS": "~/claude-code-mods/vitrin"
```

Yeni bir Claude Code oturumu aç ve `/vitrin` yaz.

Claude Code'un mod (function hooks) arayüzü erken erişimde; sürümler arasında
değişebilir.

## Geliştirme

```sh
claude plugin validate .
claude plugin test .
```

| Dosya | İçerik |
| --- | --- |
| `hooks/register.tsx` | Modun kendisi: medyayı yakalar, köprüyü çalıştırır, paneli çizer |
| `hooks/paths.ts` | Metinden dosya yolu çıkarma ve yolu bağlantıya çevirme |
| `hooks/hit.tsx` | Paneldeki tıklamaları duyan bölge |
| `bin/bridge.mjs` | Görünmeyen tarayıcıyı yöneten köprü |
| `bin/page.html` | Panelde görünen sayfa |
| `bin/onizle.swift` | `Büyüt` için Finder önizlemesi |

İlk commit, panelin yalnızca terminal öğeleriyle çizilen ilk sürümüdür.

## Lisans

MIT
