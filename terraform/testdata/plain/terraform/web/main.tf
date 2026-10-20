terraform {
  required_version = "1.16.6"
}

variable "name" {
  type    = string
  default = "guest"
}

output "greeting" {
  value = "Hello, ${var.name}"
}
