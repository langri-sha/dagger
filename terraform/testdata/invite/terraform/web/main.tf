terraform {
  required_version = "1.9.8"
}

output "invite" {
  value = file("${path.module}/../../templates/invite.html")
}
