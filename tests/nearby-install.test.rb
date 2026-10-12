# Run with Ruby and the xcodeproj gem available (included with CocoaPods).
# These tests inspect saved project graphs; they never invoke Xcode or compile.
require 'tmpdir'
require 'ostruct'
require 'xcodeproj'
require_relative '../modules/nearby-transport/ios/install_nearby'

URL = 'https://github.com/google/nearby.git'
REVISION = '2e9ff95062bd003555e4c11d9096adb859cfce72'

def assert(condition, message)
  raise message unless condition
end

def fixture
  Dir.mktmpdir('pipernet-nearby-config-') do |directory|
    pods = Xcodeproj::Project.new(File.join(directory, 'Pods.xcodeproj'))
    pods.new_target(:static_library, 'PiperNearby', :ios, '16.4')
    pods.new_target(:static_library, 'UnrelatedPod', :ios, '16.4')
    app = Xcodeproj::Project.new(File.join(directory, 'App.xcodeproj'))
    app.new_target(:application, 'App', :ios, '16.4')
    # Two aggregate targets can use the same application project.
    installer = OpenStruct.new(
      pods_project: pods,
      aggregate_targets: [OpenStruct.new(user_project: app), OpenStruct.new(user_project: app)]
    )
    yield installer, pods, app
  end
end

def check_graph(project, linked_target)
  references = project.root_object.package_references.select { |ref| ref.repositoryURL == URL }
  assert(references.length == 1, 'A clean workspace must register exactly one Nearby package per project')
  assert(references.first.requirement == { 'kind' => 'revision', 'revision' => REVISION }, 'Nearby must stay pinned')
  project.targets.each do |target|
    products = target.package_product_dependencies.select { |product| product.product_name == 'NearbyConnections' }
    links = target.frameworks_build_phase.files.select { |file| file.product_ref&.product_name == 'NearbyConnections' }
    dependencies = target.dependencies.select { |dependency| dependency.product_ref&.product_name == 'NearbyConnections' }
    expected = target.name == linked_target ? 1 : 0
    assert(products.length == expected, "Unexpected Nearby product on #{target.name}")
    assert(links.length == expected, "Unexpected Nearby link on #{target.name}")
    assert(dependencies.length == expected, "Unexpected Nearby build dependency on #{target.name}")
    assert(products.empty? || products.first.package == references.first, 'Product must resolve through its project package reference')
  end
end

fixture do |installer, pods, app|
  pipernet_install_nearby(installer)
  # Reopen from disk so serialization/save errors cannot hide in memory.
  check_graph(Xcodeproj::Project.open(pods.path), 'PiperNearby')
  check_graph(Xcodeproj::Project.open(app.path), nil)
  puts 'PASS: fresh app registers Nearby for resolution; only the mesh pod links its static product'

  pipernet_install_nearby(installer)
  check_graph(Xcodeproj::Project.open(pods.path), 'PiperNearby')
  check_graph(Xcodeproj::Project.open(app.path), nil)
  puts 'PASS: repeated post_install does not duplicate package references, links, or dependencies'

  app.root_object.package_references.first.requirement = { 'kind' => 'branch', 'branch' => 'main' }
  pod = pods.targets.find { |target| target.name == 'PiperNearby' }
  pod.frameworks_build_phase.files.find { |file| file.product_ref }.remove_from_project
  pipernet_install_nearby(installer)
  check_graph(Xcodeproj::Project.open(pods.path), 'PiperNearby')
  check_graph(Xcodeproj::Project.open(app.path), nil)
  puts 'PASS: existing project recovers a missing product link and restores the pinned revision'
end

fixture do |installer, pods, app|
  pods.targets.find { |target| target.name == 'PiperNearby' }.remove_from_project
  pipernet_install_nearby(installer)
  assert(pods.root_object.package_references.empty? && app.root_object.package_references.empty?, 'No mesh pod must leave unrelated projects untouched')
  puts 'PASS: projects without the mesh pod are unchanged'
end
