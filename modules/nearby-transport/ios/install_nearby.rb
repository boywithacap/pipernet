# Called by the generated Podfile. Keep native dependency integration in CNG,
# never patch an ios/ checkout by hand. Pin the source API used by this adapter.
def pipernet_install_nearby(installer)
  url = 'https://github.com/google/nearby.git'
  revision = '2e9ff95062bd003555e4c11d9096adb859cfce72'
  pods_project = installer.pods_project
  targets = pods_project.targets.select { |target| target.name == 'PiperNearby' }
  return if targets.empty?

  # EAS/Fastlane resolves packages from the application's workspace and scheme.
  # A reference only in Pods.xcodeproj is missed on a clean cloud worker, so
  # register the same pinned package in the application project as well.
  projects = [pods_project] + installer.aggregate_targets.map(&:user_project)
  projects.compact.uniq { |project| project.path.to_s }.each do |project|
    ref = project.root_object.package_references.find { |item| item.repositoryURL == url }
    unless ref
      ref = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
      ref.repositoryURL = url
      project.root_object.package_references << ref
    end
    ref.requirement = { 'kind' => 'revision', 'revision' => revision }

    # Nearby's static product is archived into PiperNearby. The application
    # needs the package reference for resolution, but must not link the product
    # a second time or its C++/Objective-C symbols will be duplicated.
    (project == pods_project ? targets : []).each do |target|
      product = target.package_product_dependencies.find { |item| item.product_name == 'NearbyConnections' }
      unless product
        product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
        product.package = ref
        product.product_name = 'NearbyConnections'
        target.package_product_dependencies << product
      end
      unless target.frameworks_build_phase.files.any? { |file| file.product_ref == product }
        build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
        build_file.product_ref = product
        target.frameworks_build_phase.files << build_file
      end
      # Linking a product alone is insufficient for a CocoaPods target: declare
      # the package dependency so Xcode builds/imports its Swift module first.
      unless target.dependencies.any? { |dependency| dependency.product_ref == product }
        dependency = project.new(Xcodeproj::Project::Object::PBXTargetDependency)
        dependency.product_ref = product
        target.dependencies << dependency
      end
    end
    project.save
  end
end
