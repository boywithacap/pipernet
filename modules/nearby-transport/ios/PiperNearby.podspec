Pod::Spec.new do |s|
  s.name = 'PiperNearby'
  s.version = '1.0.0'
  s.summary = 'PiperNet offline Nearby transport and bounded media inspection'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'PiperNet'
  s.homepage = 'https://github.com/google/nearby'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.swift_version = '5.9'
  s.frameworks = 'CryptoKit', 'AVFoundation', 'ImageIO'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # CocoaPods gives this target its own build directory; SwiftPM emits modules
    # in the configuration's parent directory instead.
    'SWIFT_INCLUDE_PATHS' => '$(inherited) "$(PODS_CONFIGURATION_BUILD_DIR)"',
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "$(PODS_CONFIGURATION_BUILD_DIR)/PackageFrameworks"'
  }
  # NearbyConnections is linked to this target by the CNG config plugin's post_install hook.
end
