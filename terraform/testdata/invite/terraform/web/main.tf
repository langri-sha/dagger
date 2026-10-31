terraform {
  required_version = "1.17.1"
}

output "invite" {
  value = file("${path.module}/../../templates/invite.html")
}
