# Выпуск Unvara

Памятка для сопровождающего: как выпустить новую версию, подключить подпись и обновить каталог моделей.

## Новая версия

1. Поднимите версию в `packages/desktop/package.json` (например, `0.1.1`) и закоммитьте в `main`.
2. Поставьте тег и отправьте его:
   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. Workflow `release` соберёт установщик на Windows и создаст **черновик** релиза с файлами
   `unvara-win-x64.exe`, `unvara-win-x64.exe.blockmap` и `latest.yml`.
4. Скачайте установщик из черновика, проверьте, затем нажмите **Publish release**.
   Установленные копии Unvara увидят обновление в течение нескольких минут: приложение проверяет
   последний опубликованный релиз (`latest.yml`). Черновики оно не видит.

## Подпись кода (SignPath)

Без подписи Windows показывает окно SmartScreen «Windows защитила компьютер». SignPath бесплатно подписывает
открытые проекты.

1. Подайте заявку: <https://signpath.org/apply> (нужен публичный репозиторий, лицензия MIT уже есть).
2. После одобрения в SignPath создайте проект со slug `unvara` и политику подписи `release-signing`,
   подключите к нему этот репозиторий как доверенный источник сборок (GitHub).
3. В репозитории на GitHub: **Settings → Secrets and variables → Actions**
   - переменная (Variables) `SIGNPATH_ORGANIZATION_ID` — ID организации из SignPath;
   - секрет (Secrets) `SIGNPATH_API_TOKEN` — API-токен пользователя SignPath с правом отправки запросов.
4. Всё. Следующий тег соберётся уже с подписью: workflow сам отправит установщик в SignPath, заберёт подписанный
   и пересчитает `latest.yml`. Пока переменная не задана, релизы выходят без подписи.

## Каталог моделей

Каталог обновляется без новой версии приложения: при запуске Unvara скачивает `catalog/catalog.json` из ветки
`main` и принимает его, только если подпись `catalog/catalog.json.sig` верна.

1. Поправьте `catalog/sources.yaml` и пересоберите каталог:
   ```sh
   bun script/catalog/build.ts            # весь каталог
   bun script/catalog/build.ts --only <id> # одну модель
   ```
2. Подпишите его ключом, который хранится **вне репозитория**:
   ```sh
   UNVARA_CATALOG_KEY=D:\Razrabotka\Unvara-refs\keys\catalog-signing-key.pem bun script/catalog/sign.ts
   ```
3. Закоммитьте `catalog/catalog.json` и `catalog/catalog.json.sig` в `main`. Тест
   `packages/desktop/src/main/local-models/catalog-source.test.ts` не пропустит каталог без свежей подписи.

Ключ подписи каталога нельзя терять и нельзя никому передавать: публичная половина зашита в приложение
(`catalog-source.ts`), и без приватной новые каталоги приложение не примет. Сделайте резервную копию ключа.
