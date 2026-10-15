Pod::Spec.new do |s|
  s.name = 'PiperMediaInspector'
  s.version = '1.0.0'
  s.summary = 'PiperNet bounded media validation and file hashing'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'PiperNet'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.swift_version = '5.9'
  s.frameworks = 'CryptoKit', 'AVFoundation', 'ImageIO', 'UniformTypeIdentifiers'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
