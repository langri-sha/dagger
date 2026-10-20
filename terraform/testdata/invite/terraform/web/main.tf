terraform {
  required_version = "1.16.6"
}

output "invite" {
  value = file("${path.module}/../../templates/invite.html")
}
