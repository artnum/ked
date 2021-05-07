#!bash
SLAPD=`whereis  -b slapd | awk '{print $2}'`
sh ./stop.sh
cp ./conf/schemas/* ./conf/slapd.d/cn\=config/cn\=schema/
cp ./conf/mdb.orig.ldif ./conf/slapd.d/cn\=config/olcDatabase=\{1\}mdb.ldif
mkdir -p /tmp/ked/db
mkdir -p /tmp/ked/run
$SLAPD -u `whoami` -F ./conf/slapd.d -h "ldap://127.0.0.1:9090"
if [ $? -eq 0 ]; then
	ldapadd -c -H "ldap://127.0.0.1:9090" -f ../../docs/schema/ked.ldif -D "cn=config" -w 1234 
	ldapmodify -c -H "ldap://127.0.0.1:9090" -f ./conf/update-conf.ldif -D "cn=config" -w 1234 
	ldapmodify -c -H "ldap://127.0.0.1:9090" -f ./conf/overlay.ldif -D "cn=config" -w 1234 
	ldapadd -c -H "ldap://127.0.0.1:9090" -f ./conf/init.ldif -D "cn=admin,o=artnum" -w 1234
	if [ -f ./populate.ldif ]; then
		ldapadd -c -H "ldap://127.0.0.1:9090" -f ./populate.ldif -D "cn=admin,o=artnum" -w 1234
	fi
fi
