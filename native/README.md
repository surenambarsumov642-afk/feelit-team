# Ingot для iPhone (Capacitor)

Нативная оболочка вокруг веб-приложения из `../calories`. Mac не нужен: всё собирается в GitHub Actions на macOS.

## Как устроено
- `prepare-www.sh` копирует `../calories` в `www/`. Тесты, заметки и service worker не копируются.
- `npx cap sync ios` переносит `www/` в Xcode-проект `ios/App`. Зависимости подключаются через Swift Package Manager, CocoaPods не нужен.
- ID приложения: `app.ingot.levelup`. Тексты разрешений (камера, фото) лежат в `ios/App/App/Info.plist`.
- Внутри приложения веб-код видит `window.Capacitor`, поэтому service worker и веб-пуши отключаются.

## Сборка
- **Проверка:** workflow «Собрать iOS (симулятор)» (`.github/workflows/ios-build.yml`). Он собирает приложение без подписи, запускает его в симуляторе iPhone и сохраняет скриншот в артефакт `ios-screenshot`.
- **TestFlight и App Store:** нужен аккаунт Apple Developer. После оплаты добавим в секреты репозитория ключ App Store Connect API (Issuer ID, Key ID, файл .p8) и workflow подписи и загрузки в TestFlight.

## Что дальше
1. Подписка Ingot Gold через StoreKit (покупки Apple) и проверка покупок на сервере.
2. Нативные push-уведомления (APNs) вместо веб-пушей.
3. Виджет на экран «Домой» и шаги из «Здоровья» (HealthKit).
