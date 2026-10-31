terraform {
  required_version = "1.17.0"
}

module "network" {
  source = "./modules/network"
}

output "cidr" {
  value = module.network.cidr
}
