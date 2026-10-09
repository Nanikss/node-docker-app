output "public_ip" {
  description = "Public IP of the instance (use as the EC2_HOST secret)."
  value       = aws_instance.app.public_ip
}

output "url" {
  description = "Base URL of the service."
  value       = "http://${aws_instance.app.public_ip}"
}
