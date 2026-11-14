terraform {
  required_version = "1.17.2"
}

variable "name" {
  type    = string
  default = "guest"
}

output "greeting" {
  value = "Hello, ${var.name}"
}
