terraform {
  required_version = "1.17.0"
}

variable "name" {
  type    = string
  default = "guest"
}

output "greeting" {
  value = "Hello, ${var.name}"
}
