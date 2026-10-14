require 'json'
Pod::Spec.new do |s|
  s.name = 'PiperBle'
  s.version = '1.0.0'
  s.summary = 'PiperNet automatic BLE discovery and encrypted file transport'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'PiperNet'
  s.homepage = 'https://github.com/rweather/noise-c'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.9'
  s.frameworks = 'CoreBluetooth'
  sources = JSON.parse(File.read(File.join(__dir__, 'shared/sources.json')))
  s.source_files = ['ios/*.swift', 'shared/PiperBle.h'] + sources.map { |p| "shared/#{p}" }
  s.preserve_paths = 'shared/**/*'
  s.public_header_files = 'shared/PiperBle.h'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) ED25519_CUSTOMHASH ED25519_CUSTOMRANDOM',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/shared" "${PODS_TARGET_SRCROOT}/shared/vendor/noise/include" "${PODS_TARGET_SRCROOT}/shared/vendor/noise/src" "${PODS_TARGET_SRCROOT}/shared/vendor/noise/src/protocol"'
  }
end
