#!bash

if [ -f /tmp/ked/run/slapd.pid ]; then
	ldapsearch -LLL -H "ldap://127.0.0.1:9090" -s children -b "o=ked" -D "cn=admin,o=ked" -w 1234 > ./populate.ldif
	kill -INT `cat /tmp/ked/run/slapd.pid`
fi
rm -f ./conf/slapd.d/cn\=config/cn\=schema/* > /dev/null
rm -f -R /tmp/ked/db > /dev/null
rm -f -R /tmp/ked/run > /dev/null

