terraform {
  required_version = "1.17.1"
}

module "network" {
  source = "../modules/network"
}

output "cidr" {
  value = module.network.cidr
}
