terraform {
  required_version = "1.9.8"
}

variable "name" {
  type    = string
  default = "guest"
}

output "greeting" {
  value = "Hello, ${var.name}"
}
